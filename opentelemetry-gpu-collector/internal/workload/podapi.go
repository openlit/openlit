package workload

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// PodAPIClient lists pods on the current node via the Kubernetes API.
type PodAPIClient struct {
	logger    *slog.Logger
	client    *http.Client
	host      string
	tokenPath string
	nodeName  string
}

// NewPodAPIClient uses in-cluster config (service account).
func NewPodAPIClient(logger *slog.Logger) (*PodAPIClient, error) {
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	port := os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" || port == "" {
		return nil, fmt.Errorf("not in cluster")
	}
	tokenPath := "/var/run/secrets/kubernetes.io/serviceaccount/token"
	if _, err := os.Stat(tokenPath); err != nil {
		return nil, err
	}
	ca, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		return nil, fmt.Errorf("failed to parse serviceaccount CA")
	}
	nodeName := os.Getenv("K8S_NODE_NAME")
	if nodeName == "" {
		nodeName = os.Getenv("NODE_NAME")
	}
	if nodeName == "" {
		return nil, fmt.Errorf("K8S_NODE_NAME required for pod API lookup")
	}
	return &PodAPIClient{
		logger: logger,
		client: &http.Client{
			Timeout: 3 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
			},
		},
		host:      "https://" + host + ":" + port,
		tokenPath: tokenPath,
		nodeName:  nodeName,
	}, nil
}

type podList struct {
	Items []struct {
		Metadata struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
			UID       string `json:"uid"`
		} `json:"metadata"`
		Status struct {
			ContainerStatuses []struct {
				Name        string `json:"name"`
				ContainerID string `json:"containerID"`
			} `json:"containerStatuses"`
		} `json:"status"`
	} `json:"items"`
}

// ListNodePods returns PodInfo for pods scheduled on this node.
func (c *PodAPIClient) ListNodePods(ctx context.Context) ([]PodInfo, error) {
	token, err := os.ReadFile(c.tokenPath)
	if err != nil {
		return nil, err
	}
	u, err := url.Parse(c.host + "/api/v1/pods")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("fieldSelector", "spec.nodeName="+c.nodeName)
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("pod list: %s: %s", resp.Status, string(body))
	}
	var pl podList
	if err := json.NewDecoder(resp.Body).Decode(&pl); err != nil {
		return nil, err
	}
	out := make([]PodInfo, 0)
	for _, item := range pl.Items {
		for _, cs := range item.Status.ContainerStatuses {
			cid := stripRuntimePrefix(cs.ContainerID)
			out = append(out, PodInfo{
				PodUID:        item.Metadata.UID,
				PodName:       item.Metadata.Name,
				Namespace:     item.Metadata.Namespace,
				ContainerName: cs.Name,
				ContainerID:   cid,
			})
		}
		if len(item.Status.ContainerStatuses) == 0 {
			out = append(out, PodInfo{
				PodUID:    item.Metadata.UID,
				PodName:   item.Metadata.Name,
				Namespace: item.Metadata.Namespace,
			})
		}
	}
	return out, nil
}

// Close releases idle HTTP connections.
func (c *PodAPIClient) Close() {
	if c == nil || c.client == nil {
		return
	}
	if t, ok := c.client.Transport.(*http.Transport); ok {
		t.CloseIdleConnections()
	}
}

func stripRuntimePrefix(cid string) string {
	if i := strings.Index(cid, "://"); i >= 0 {
		return cid[i+3:]
	}
	return cid
}
