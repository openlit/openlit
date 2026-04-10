package engine

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/openlit/openlit/openlit-controller/internal/config"
	"github.com/openlit/openlit/openlit-controller/internal/openlit"
	"go.uber.org/zap"
)

var containerIDRegex = regexp.MustCompile(`[a-f0-9]{64}`)

// ContainerEnricher enriches discovered services with container/K8s metadata.
type ContainerEnricher struct {
	logger       *zap.Logger
	k8sClient    *k8sAPIClient
	dockerClient *dockerAPIClient
	nodeName     string
	podCache     sync.Map // containerID -> *PodInfo
}

// PodInfo holds Kubernetes pod metadata resolved from a container ID.
type PodInfo struct {
	PodName        string
	PodUID         string
	Namespace      string
	DeploymentName string
	WorkloadKind   string
	Labels         map[string]string
	NodeName       string
	fetchedAt      time.Time
}

type ContainerMetadata struct {
	ContainerID   string
	ContainerName string
	PodName       string
	PodUID        string
	WorkloadKind  string
}

func NewContainerEnricher(logger *zap.Logger, mode config.DeployMode) *ContainerEnricher {
	e := &ContainerEnricher{
		logger:   logger,
		nodeName: os.Getenv("NODE_NAME"),
	}

	if e.nodeName == "" {
		e.nodeName, _ = os.Hostname()
	}

	if mode == config.DeployDocker || mode == config.DeployLinux {
		client, err := newDockerAPIClient(logger)
		if err != nil {
			if mode == config.DeployDocker {
				logger.Warn("Docker socket not available; container name resolution disabled", zap.Error(err))
			} else {
				logger.Debug("Docker socket not available in Linux mode; Docker container Agent O11y will be unsupported", zap.Error(err))
			}
		} else {
			e.dockerClient = client
			logger.Info("Docker API client initialized for container management", zap.String("mode", string(mode)))
		}
	}

	if mode == config.DeployKubernetes {
		client, err := newK8sAPIClient(logger)
		if err != nil {
			logger.Warn("failed to create K8s API client; pod metadata enrichment disabled", zap.Error(err))
		} else {
			e.k8sClient = client
		}
	}

	return e
}

// Enrich adds container and K8s metadata to a discovered service.
func (e *ContainerEnricher) Enrich(svc *openlit.DiscoveredService, procRoot string, pid int, mode config.DeployMode) *ContainerMetadata {
	containerID := getContainerID(procRoot, pid)
	if containerID == "" {
		return nil
	}

	meta := &ContainerMetadata{ContainerID: containerID}

	if mode == config.DeployDocker {
		if e.dockerClient != nil {
			name, err := e.dockerClient.containerName(containerID)
			if err != nil {
				e.logger.Debug("failed to resolve container name, using container ID",
					zap.String("container_id", containerID[:12]), zap.Error(err))
				svc.ServiceName = containerID[:12]
			} else {
				svc.ServiceName = name
				meta.ContainerName = name
			}
		} else if svc.ServiceName == "" || svc.ServiceName == "unknown" {
			svc.ServiceName = containerID[:12]
		}
		return meta
	}

	if mode == config.DeployKubernetes && e.k8sClient != nil {
		if cached, ok := e.podCache.Load(containerID); ok {
			info := cached.(*PodInfo)
			if time.Since(info.fetchedAt) < 2*time.Minute {
				applyPodInfo(svc, info)
				meta.PodName = info.PodName
				meta.PodUID = info.PodUID
				meta.WorkloadKind = info.WorkloadKind
				return meta
			}
		}

		info, err := e.k8sClient.getPodByContainerID(containerID, e.nodeName)
		if err != nil {
			e.logger.Debug("failed to resolve pod info", zap.String("container_id", containerID[:12]), zap.Error(err))
			return meta
		}
		info.fetchedAt = time.Now()
		e.podCache.Store(containerID, info)
		applyPodInfo(svc, info)
		meta.PodName = info.PodName
		meta.PodUID = info.PodUID
		meta.WorkloadKind = info.WorkloadKind
	}

	return meta
}

func applyPodInfo(svc *openlit.DiscoveredService, info *PodInfo) {
	if info.DeploymentName != "" {
		svc.ServiceName = info.DeploymentName
	} else {
		svc.ServiceName = info.PodName
	}
	svc.Namespace = info.Namespace
	svc.DeploymentName = info.DeploymentName
}

// getContainerID extracts the container ID from /proc/<pid>/cgroup.
func getContainerID(procRoot string, pid int) string {
	// Try cgroup v1
	path := filepath.Join(procRoot, strconv.Itoa(pid), "cgroup")
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if match := containerIDRegex.FindString(line); match != "" {
			return match
		}
	}

	// Try mountinfo for cgroup v2
	path = filepath.Join(procRoot, strconv.Itoa(pid), "mountinfo")
	f2, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f2.Close()

	scanner = bufio.NewScanner(f2)
	for scanner.Scan() {
		line := scanner.Text()
		if match := containerIDRegex.FindString(line); match != "" {
			return match
		}
	}

	return ""
}

// k8sAPIClient is a lightweight K8s API client that uses the in-cluster service account.
type k8sAPIClient struct {
	httpClient *http.Client
	apiServer  string
	token      string
	logger     *zap.Logger
}

func newK8sAPIClient(logger *zap.Logger) (*k8sAPIClient, error) {
	tokenBytes, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token")
	if err != nil {
		return nil, fmt.Errorf("reading service account token: %w", err)
	}

	return &k8sAPIClient{
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
		apiServer: "https://kubernetes.default.svc",
		token:     string(tokenBytes),
		logger:    logger,
	}, nil
}

func (c *k8sAPIClient) getPodByContainerID(containerID, nodeName string) (*PodInfo, error) {
	url := fmt.Sprintf("%s/api/v1/pods?fieldSelector=spec.nodeName=%s&limit=500", c.apiServer, nodeName)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("K8s API returned %d", resp.StatusCode)
	}

	var podList struct {
		Items []struct {
			Metadata struct {
				Name            string            `json:"name"`
				UID             string            `json:"uid"`
				Namespace       string            `json:"namespace"`
				Labels          map[string]string `json:"labels"`
				OwnerReferences []struct {
					Kind string `json:"kind"`
					Name string `json:"name"`
				} `json:"ownerReferences"`
			} `json:"metadata"`
			Spec struct {
				NodeName string `json:"nodeName"`
			} `json:"spec"`
			Status struct {
				ContainerStatuses []struct {
					ContainerID string `json:"containerID"`
				} `json:"containerStatuses"`
			} `json:"status"`
		} `json:"items"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&podList); err != nil {
		return nil, fmt.Errorf("decoding pod list: %w", err)
	}

	for _, pod := range podList.Items {
		for _, cs := range pod.Status.ContainerStatuses {
			// containerID format: containerd://<hash> or docker://<hash>
			if strings.Contains(cs.ContainerID, containerID) {
				info := &PodInfo{
					PodName:   pod.Metadata.Name,
					PodUID:    pod.Metadata.UID,
					Namespace: pod.Metadata.Namespace,
					Labels:    pod.Metadata.Labels,
					NodeName:  pod.Spec.NodeName,
				}

				foundOwner := false
				for _, ref := range pod.Metadata.OwnerReferences {
					if ref.Kind == "ReplicaSet" {
						hash := pod.Metadata.Labels["pod-template-hash"]
						if hash != "" && strings.HasSuffix(ref.Name, "-"+hash) {
							info.DeploymentName = strings.TrimSuffix(ref.Name, "-"+hash)
							info.WorkloadKind = "Deployment"
						} else {
							info.DeploymentName = ref.Name
							info.WorkloadKind = "ReplicaSet"
						}
						foundOwner = true
						break
					}
					if ref.Kind == "Deployment" || ref.Kind == "StatefulSet" || ref.Kind == "DaemonSet" {
						info.DeploymentName = ref.Name
						info.WorkloadKind = ref.Kind
						foundOwner = true
						break
					}
				}
				if !foundOwner {
					info.WorkloadKind = "Pod"
				}

				return info, nil
			}
		}
	}

	return nil, fmt.Errorf("no pod found for container %s on node %s", containerID[:12], nodeName)
}

func (c *k8sAPIClient) getWorkload(namespace, kind, name string) (map[string]any, error) {
	resource, err := k8sWorkloadResource(kind)
	if err != nil {
		return nil, err
	}

	endpoint := fmt.Sprintf(
		"%s/apis/apps/v1/namespaces/%s/%s/%s",
		c.apiServer,
		url.PathEscape(namespace),
		resource,
		url.PathEscape(name),
	)
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("K8s workload lookup returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var workload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&workload); err != nil {
		return nil, fmt.Errorf("decoding workload: %w", err)
	}
	return workload, nil
}

func (c *k8sAPIClient) patchWorkload(namespace, kind, name string, patch map[string]any) error {
	resource, err := k8sWorkloadResource(kind)
	if err != nil {
		return err
	}

	body, err := json.Marshal(patch)
	if err != nil {
		return fmt.Errorf("marshal workload patch: %w", err)
	}

	endpoint := fmt.Sprintf(
		"%s/apis/apps/v1/namespaces/%s/%s/%s",
		c.apiServer,
		url.PathEscape(namespace),
		resource,
		url.PathEscape(name),
	)
	req, err := http.NewRequest(http.MethodPatch, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/merge-patch+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("K8s workload patch returned %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}

	return nil
}

func k8sWorkloadResource(kind string) (string, error) {
	switch strings.ToLower(kind) {
	case "deployment":
		return "deployments", nil
	case "statefulset":
		return "statefulsets", nil
	case "daemonset":
		return "daemonsets", nil
	case "replicaset":
		return "replicasets", nil
	default:
		return "", fmt.Errorf("unsupported Kubernetes workload kind: %s", kind)
	}
}

func (c *k8sAPIClient) getPod(namespace, name string) (map[string]any, error) {
	endpoint := fmt.Sprintf(
		"%s/api/v1/namespaces/%s/pods/%s",
		c.apiServer,
		url.PathEscape(namespace),
		url.PathEscape(name),
	)
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("K8s get pod returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var pod map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&pod); err != nil {
		return nil, fmt.Errorf("decoding pod: %w", err)
	}
	return pod, nil
}

func (c *k8sAPIClient) deletePod(namespace, name string, gracePeriod int) error {
	endpoint := fmt.Sprintf(
		"%s/api/v1/namespaces/%s/pods/%s?gracePeriodSeconds=%d",
		c.apiServer,
		url.PathEscape(namespace),
		url.PathEscape(name),
		gracePeriod,
	)
	req, err := http.NewRequest(http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("K8s delete pod returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func (c *k8sAPIClient) createPod(namespace string, pod map[string]any) error {
	body, err := json.Marshal(pod)
	if err != nil {
		return fmt.Errorf("marshal pod: %w", err)
	}

	endpoint := fmt.Sprintf(
		"%s/api/v1/namespaces/%s/pods",
		c.apiServer,
		url.PathEscape(namespace),
	)
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("K8s create pod returned %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	return nil
}

// --- Docker API client (Unix socket) ---

type dockerAPIClient struct {
	httpClient *http.Client
	logger     *zap.Logger
	nameCache  sync.Map // containerID -> cachedName
	writable   bool
}

type cachedName struct {
	name      string
	fetchedAt time.Time
}

const dockerSocket = "/var/run/docker.sock"

func newDockerAPIClient(logger *zap.Logger) (*dockerAPIClient, error) {
	if _, err := os.Stat(dockerSocket); err != nil {
		return nil, fmt.Errorf("docker socket not found at %s: %w", dockerSocket, err)
	}

	transport := &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			return net.DialTimeout("unix", dockerSocket, 2*time.Second)
		},
	}

	return &dockerAPIClient{
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   5 * time.Second,
		},
		logger:   logger,
		writable: canCurrentProcessWrite(dockerSocket),
	}, nil
}

func canCurrentProcessWrite(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	mode := info.Mode().Perm()
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}

	uid := uint32(os.Geteuid())
	if uid == 0 {
		return true
	}
	if uid == stat.Uid && mode&0200 != 0 {
		return true
	}

	gids, err := os.Getgroups()
	if err == nil {
		for _, gid := range gids {
			if uint32(gid) == stat.Gid && mode&0020 != 0 {
				return true
			}
		}
	}

	return mode&0002 != 0
}

func (d *dockerAPIClient) containerName(containerID string) (string, error) {
	if cached, ok := d.nameCache.Load(containerID); ok {
		cn := cached.(*cachedName)
		if time.Since(cn.fetchedAt) < 5*time.Minute {
			return cn.name, nil
		}
	}

	url := fmt.Sprintf("http://docker/containers/%s/json", containerID)
	resp, err := d.httpClient.Get(url)
	if err != nil {
		return "", fmt.Errorf("docker API request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("docker API returned %d for container %s", resp.StatusCode, containerID[:12])
	}

	var info struct {
		Name string `json:"Name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", fmt.Errorf("decoding docker response: %w", err)
	}

	name := strings.TrimPrefix(info.Name, "/")
	if name == "" {
		name = containerID[:12]
	}

	d.nameCache.Store(containerID, &cachedName{name: name, fetchedAt: time.Now()})
	return name, nil
}

func (d *dockerAPIClient) canManage() bool {
	return d.writable
}

func (d *dockerAPIClient) inspectContainer(containerID string) (map[string]any, error) {
	resp, err := d.doRequest(http.MethodGet, fmt.Sprintf("/containers/%s/json", containerID), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("docker inspect returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decoding docker inspect response: %w", err)
	}
	return payload, nil
}

func (d *dockerAPIClient) createVolume(name string, labels map[string]string) error {
	body, _ := json.Marshal(map[string]any{
		"Name":   name,
		"Driver": "local",
		"Labels": labels,
	})
	resp, err := d.doRequest(http.MethodPost, "/volumes/create", bytes.NewReader(body), "application/json")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		payload, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("docker create volume returned %d: %s", resp.StatusCode, strings.TrimSpace(string(payload)))
	}
	return nil
}

func (d *dockerAPIClient) removeVolume(name string) error {
	resp, err := d.doRequest(http.MethodDelete, fmt.Sprintf("/volumes/%s", url.PathEscape(name)), nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		payload, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("docker remove volume returned %d: %s", resp.StatusCode, strings.TrimSpace(string(payload)))
	}
	return nil
}

func (d *dockerAPIClient) createContainer(name string, payload map[string]any) (string, error) {
	body, _ := json.Marshal(payload)
	endpoint := "/containers/create"
	if name != "" {
		endpoint += "?name=" + url.QueryEscape(name)
	}
	resp, err := d.doRequest(http.MethodPost, endpoint, bytes.NewReader(body), "application/json")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		responseBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("docker create container returned %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}

	var result struct {
		ID string `json:"Id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding docker create container response: %w", err)
	}
	return result.ID, nil
}

func (d *dockerAPIClient) putArchive(containerID, targetPath string, tarball []byte) error {
	resp, err := d.doRequest(
		http.MethodPut,
		fmt.Sprintf("/containers/%s/archive?path=%s", containerID, url.QueryEscape(targetPath)),
		bytes.NewReader(tarball),
		"application/x-tar",
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("docker put archive returned %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	return nil
}

func (d *dockerAPIClient) startContainer(containerID string) error {
	resp, err := d.doRequest(http.MethodPost, fmt.Sprintf("/containers/%s/start", containerID), nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotModified {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("docker start returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func (d *dockerAPIClient) waitContainer(containerID string) (int, error) {
	resp, err := d.doRequest(http.MethodPost, fmt.Sprintf("/containers/%s/wait", containerID), nil, "")
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("docker wait returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload struct {
		StatusCode int `json:"StatusCode"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return 0, fmt.Errorf("decoding docker wait response: %w", err)
	}
	return payload.StatusCode, nil
}

func (d *dockerAPIClient) stopContainer(containerID string, timeoutSeconds int) error {
	endpoint := fmt.Sprintf("/containers/%s/stop?t=%d", containerID, timeoutSeconds)
	resp, err := d.doRequest(http.MethodPost, endpoint, nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotModified {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("docker stop returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func (d *dockerAPIClient) renameContainer(containerID, newName string) error {
	resp, err := d.doRequest(http.MethodPost, fmt.Sprintf("/containers/%s/rename?name=%s", containerID, url.QueryEscape(newName)), nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("docker rename returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func (d *dockerAPIClient) removeContainer(containerID string, force bool) error {
	endpoint := fmt.Sprintf("/containers/%s?force=%t", containerID, force)
	resp, err := d.doRequest(http.MethodDelete, endpoint, nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("docker remove returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func (d *dockerAPIClient) doRequest(method, endpoint string, body io.Reader, contentType string) (*http.Response, error) {
	req, err := http.NewRequest(method, "http://docker"+endpoint, body)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return d.httpClient.Do(req)
}
