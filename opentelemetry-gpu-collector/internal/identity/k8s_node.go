package identity

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
)

const (
	labelInstanceTypeStable = "node.kubernetes.io/instance-type"
	labelInstanceTypeBeta   = "beta.kubernetes.io/instance-type"
	labelOCIShape           = "oci.oraclecloud.com/instance-shape"
	labelRegionStable       = "topology.kubernetes.io/region"
	labelRegionBeta         = "failure-domain.beta.kubernetes.io/region"
	labelZoneStable         = "topology.kubernetes.io/zone"
	labelZoneBeta           = "failure-domain.beta.kubernetes.io/zone"

	k8sNodeLookupTimeout = 800 * time.Millisecond
)

// cloudIdentity holds cloud / instance attrs filled by discovery tiers.
type cloudIdentity struct {
	Provider         string
	Platform         string
	HostType         string
	Region           string
	AvailabilityZone string
	AccountID        string
	HostID           string
	HostTypeSource   string // env | k8s_label | imds | dmi
}

// nodeCloudInfo is the subset of a Kubernetes Node we care about.
type nodeCloudInfo struct {
	ProviderID     string
	KubeletVersion string
	Labels         map[string]string
}

// k8sNodeLookupEnabled is true unless OPENLIT_K8S_NODE_LOOKUP=false.
func k8sNodeLookupEnabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("OPENLIT_K8S_NODE_LOOKUP")))
	return v != "false" && v != "0" && v != "no"
}

// fetchNodeCloudInfo GETs /api/v1/nodes/$name using in-cluster credentials.
// Returns nil, nil when lookup is disabled or not in-cluster.
func fetchNodeCloudInfo(ctx context.Context, nodeName string) (*nodeCloudInfo, error) {
	if nodeName == "" || !k8sNodeLookupEnabled() {
		return nil, nil
	}
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	port := os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" {
		return nil, nil
	}
	if port == "" {
		port = "443"
	}

	token, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token")
	if err != nil || len(token) == 0 {
		return nil, fmt.Errorf("service account token: %w", err)
	}

	client, err := inClusterHTTPClient()
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(ctx, k8sNodeLookupTimeout)
	defer cancel()

	u := &url.URL{
		Scheme: "https",
		Host:   netJoinHostPort(host, port),
		Path:   path.Join("/api/v1/nodes", nodeName),
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nodes/%s: status %d", nodeName, resp.StatusCode)
	}
	return parseNodeCloudJSON(body)
}

func netJoinHostPort(host, port string) string {
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		return "[" + host + "]:" + port
	}
	return host + ":" + port
}

func inClusterHTTPClient() (*http.Client, error) {
	ca, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
	if err != nil {
		return nil, fmt.Errorf("service account CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		return nil, fmt.Errorf("failed to parse service account CA")
	}
	return &http.Client{
		Timeout: k8sNodeLookupTimeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
		},
	}, nil
}

func parseNodeCloudJSON(data []byte) (*nodeCloudInfo, error) {
	var raw struct {
		Metadata struct {
			Labels map[string]string `json:"labels"`
		} `json:"metadata"`
		Spec struct {
			ProviderID string `json:"providerID"`
		} `json:"spec"`
		Status struct {
			NodeInfo struct {
				KubeletVersion string `json:"kubeletVersion"`
			} `json:"nodeInfo"`
		} `json:"status"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	return &nodeCloudInfo{
		ProviderID:     raw.Spec.ProviderID,
		KubeletVersion: raw.Status.NodeInfo.KubeletVersion,
		Labels:         raw.Metadata.Labels,
	}, nil
}

// cloudIdentityFromNode extracts cloud attrs from a Kubernetes Node (OpenCost-style).
func cloudIdentityFromNode(n *nodeCloudInfo) cloudIdentity {
	if n == nil {
		return cloudIdentity{}
	}
	ci := cloudIdentity{}

	ci.Provider, ci.Platform = providerFromProviderID(n.ProviderID, n.KubeletVersion, n.Labels)
	ci.HostType = instanceTypeFromLabels(n.Labels)
	ci.Region = firstLabel(n.Labels, labelRegionStable, labelRegionBeta)
	ci.AvailabilityZone = firstLabel(n.Labels, labelZoneStable, labelZoneBeta)
	ci.HostID = hostIDFromProviderID(n.ProviderID)

	if ci.HostType == "" && ci.Provider == "" && ci.Region == "" {
		return cloudIdentity{}
	}
	if ci.HostType != "" {
		ci.HostTypeSource = "k8s_label"
	}
	return ci
}

func firstLabel(labels map[string]string, keys ...string) string {
	if labels == nil {
		return ""
	}
	for _, k := range keys {
		if v := strings.TrimSpace(labels[k]); v != "" {
			return v
		}
	}
	return ""
}

func instanceTypeFromLabels(labels map[string]string) string {
	if labels == nil {
		return ""
	}
	for _, k := range []string{labelInstanceTypeStable, labelInstanceTypeBeta, labelOCIShape} {
		v := strings.TrimSpace(labels[k])
		if !validInstanceType(v) {
			continue
		}
		return v
	}
	return ""
}

// validInstanceType rejects garbage values like bare "k3s".
func validInstanceType(v string) bool {
	if v == "" {
		return false
	}
	lower := strings.ToLower(v)
	if lower == "k3s" || lower == "unknown" || lower == "none" {
		return false
	}
	hasDigit, hasSep := false, false
	for _, r := range v {
		if r >= '0' && r <= '9' {
			hasDigit = true
		}
		if r == '-' || r == '.' || r == '_' {
			hasSep = true
		}
	}
	return hasDigit || hasSep
}

func providerFromProviderID(providerID, kubeletVersion string, labels map[string]string) (provider, platform string) {
	id := strings.ToLower(strings.TrimSpace(providerID))
	switch {
	case strings.HasPrefix(id, "aws://"):
		return "aws", "aws_eks"
	case strings.HasPrefix(id, "gce://"):
		return "gcp", "gcp_kubernetes_engine"
	case strings.HasPrefix(id, "azure://"):
		return "azure", "azure_aks"
	case strings.HasPrefix(id, "ocid") || strings.Contains(id, "ocid1.instance"):
		return "oracle_cloud", "oracle_cloud_oke"
	case strings.HasPrefix(id, "scaleway://"):
		return "scaleway", "scaleway_kapsule"
	case strings.HasPrefix(id, "digitalocean://"):
		return "digitalocean", "digitalocean_kubernetes"
	}

	kv := strings.ToLower(kubeletVersion)
	if strings.Contains(kv, "eks") {
		return "aws", "aws_eks"
	}
	if strings.Contains(kv, "aliyun") {
		return "alibaba_cloud", "alibaba_cloud_ack"
	}
	if labels != nil {
		if _, ok := labels["cce.cloud.com/cce-nodepool"]; ok {
			return "otc", "otc_cce"
		}
	}
	return "", ""
}

// hostIDFromProviderID parses cloud instance IDs from common providerID forms.
func hostIDFromProviderID(providerID string) string {
	id := strings.TrimSpace(providerID)
	if id == "" {
		return ""
	}
	lower := strings.ToLower(id)

	if strings.HasPrefix(lower, "aws://") {
		rest := id[len("aws://"):]
		parts := strings.Split(rest, "/")
		for i := len(parts) - 1; i >= 0; i-- {
			if parts[i] != "" {
				return parts[i]
			}
		}
	}

	if strings.HasPrefix(lower, "gce://") {
		rest := id[len("gce://"):]
		parts := strings.Split(rest, "/")
		if len(parts) >= 3 {
			return parts[len(parts)-1]
		}
	}

	if strings.HasPrefix(lower, "azure://") {
		// VMSS: .../virtualMachineScaleSets/<name>/virtualMachines/<ordinal>
		// Prefer name/ordinal over bare "0", which is not a useful host.id.
		const vmssMarker = "/virtualmachinescalesets/"
		const vmMarker = "/virtualmachines/"
		if i := strings.LastIndex(lower, vmssMarker); i >= 0 {
			rest := id[i+len(vmssMarker):]
			parts := strings.Split(rest, "/")
			if len(parts) >= 3 && strings.EqualFold(parts[1], "virtualMachines") {
				return parts[0] + "/" + parts[2]
			}
		}
		idx := strings.LastIndex(lower, vmMarker)
		if idx >= 0 {
			return id[idx+len(vmMarker):]
		}
	}
	return ""
}
