package engine

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
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
	Labels         map[string]string
	NodeName       string
	fetchedAt      time.Time
}

type ContainerMetadata struct {
	ContainerID   string
	ContainerName string
	PodName       string
	PodUID        string
}

func NewContainerEnricher(logger *zap.Logger, mode config.DeployMode) *ContainerEnricher {
	e := &ContainerEnricher{
		logger:   logger,
		nodeName: os.Getenv("NODE_NAME"),
	}

	if e.nodeName == "" {
		e.nodeName, _ = os.Hostname()
	}

	if mode == config.DeployDocker {
		client, err := newDockerAPIClient(logger)
		if err != nil {
			logger.Warn("Docker socket not available; container name resolution disabled", zap.Error(err))
		} else {
			e.dockerClient = client
			logger.Info("Docker API client initialized for container name resolution")
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

				for _, ref := range pod.Metadata.OwnerReferences {
					if ref.Kind == "ReplicaSet" {
						// Strip the ReplicaSet hash suffix to get the Deployment name
						parts := strings.Split(ref.Name, "-")
						if len(parts) > 1 {
							info.DeploymentName = strings.Join(parts[:len(parts)-1], "-")
						} else {
							info.DeploymentName = ref.Name
						}
						break
					}
					if ref.Kind == "Deployment" || ref.Kind == "StatefulSet" || ref.Kind == "DaemonSet" {
						info.DeploymentName = ref.Name
						break
					}
				}

				return info, nil
			}
		}
	}

	return nil, fmt.Errorf("no pod found for container %s on node %s", containerID[:12], nodeName)
}

// --- Docker API client (Unix socket) ---

type dockerAPIClient struct {
	httpClient *http.Client
	logger     *zap.Logger
	nameCache  sync.Map // containerID -> cachedName
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
		logger: logger,
	}, nil
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
