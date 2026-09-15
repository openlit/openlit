package identity

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	// Keep probes short: on non-cloud hosts 169.254.169.254 typically blackholes
	// until Client.Timeout, which would stall collector startup.
	metadataTimeout   = 250 * time.Millisecond
	cloudDetectBudget = 600 * time.Millisecond
	metadataMaxBody   = 256 << 10 // Azure compute JSON can exceed 4 KiB

	gceMetadataBase = "http://169.254.169.254/computeMetadata/v1"
	azureIMDSBase   = "http://169.254.169.254/metadata"
	ec2IMDSBase     = "http://169.254.169.254/latest"
)

// httpDoer is the subset of *http.Client used by cloud probes (injectable in tests).
type httpDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

func defaultHTTPClient() *http.Client {
	return &http.Client{
		Timeout: metadataTimeout,
		Transport: &http.Transport{
			Proxy: nil, // never send link-local IMDS via HTTP_PROXY
			DialContext: (&net.Dialer{
				Timeout:   metadataTimeout,
				KeepAlive: 0,
			}).DialContext,
			DisableKeepAlives:     true,
			TLSHandshakeTimeout:   metadataTimeout,
			ResponseHeaderTimeout: metadataTimeout,
			ExpectContinueTimeout: 0,
			MaxIdleConns:          0,
		},
	}
}

func httpGet(ctx context.Context, client httpDoer, url string, headers map[string]string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, metadataMaxBody))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("metadata %s: status %d", url, resp.StatusCode)
	}
	return strings.TrimSpace(string(body)), nil
}

func httpPut(ctx context.Context, client httpDoer, url string, headers map[string]string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, nil)
	if err != nil {
		return "", err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, metadataMaxBody))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("metadata PUT %s: status %d", url, resp.StatusCode)
	}
	return strings.TrimSpace(string(body)), nil
}

// clusterNameFromGKE reads GCE instance attribute cluster-name (GKE nodes).
func clusterNameFromGKE(ctx context.Context, client httpDoer) (string, error) {
	return httpGet(ctx, client, gceMetadataBase+"/instance/attributes/cluster-name", map[string]string{
		"Metadata-Flavor": "Google",
	})
}

// hostnameFromGCE reads the GCE instance hostname.
func hostnameFromGCE(ctx context.Context, client httpDoer) (string, error) {
	return httpGet(ctx, client, gceMetadataBase+"/instance/hostname", map[string]string{
		"Metadata-Flavor": "Google",
	})
}

// clusterNameFromAKS reads Azure IMDS resource group and parses the AKS cluster name.
func clusterNameFromAKS(ctx context.Context, client httpDoer) (string, error) {
	rg, err := httpGet(ctx, client, azureIMDSBase+"/instance/compute/resourceGroupName?api-version=2017-08-01&format=text", map[string]string{
		"Metadata": "true",
	})
	if err != nil {
		return "", err
	}
	name := parseAKSClusterName(rg)
	if name == "" {
		return "", fmt.Errorf("unable to parse AKS cluster name from resource group %q", rg)
	}
	return name, nil
}

// parseAKSClusterName extracts the cluster name from an AKS node resource group.
// Format: MC_<resourceGroup>_<clusterName>_<region>
func parseAKSClusterName(resourceGroup string) string {
	if !strings.HasPrefix(strings.ToUpper(resourceGroup), "MC_") {
		return ""
	}
	parts := strings.Split(resourceGroup, "_")
	if len(parts) < 4 {
		return ""
	}
	// Last segment is region; second-to-last is cluster name.
	return parts[len(parts)-2]
}

// clusterNameFromEKS reads EC2 IMDS instance tags for kubernetes.io/cluster/<name>.
func clusterNameFromEKS(ctx context.Context, client httpDoer) (string, error) {
	headers := map[string]string{}
	if token, err := httpPut(ctx, client, ec2IMDSBase+"/api/token", map[string]string{
		"X-aws-ec2-metadata-token-ttl-seconds": "60",
	}); err == nil && token != "" {
		headers["X-aws-ec2-metadata-token"] = token
	}
	// If IMDSv2 token fails, fall through to IMDSv1 (no token header).
	keysBody, err := httpGet(ctx, client, ec2IMDSBase+"/meta-data/tags/instance", headers)
	if err != nil {
		return "", err
	}
	for _, key := range strings.Split(keysBody, "\n") {
		key = strings.TrimSpace(key)
		if name := clusterNameFromEKSTagKey(key); name != "" {
			return name, nil
		}
	}
	return "", fmt.Errorf("no kubernetes.io/cluster/* tag on instance")
}

// clusterNameFromEKSTagKey extracts the cluster name from a tag key like
// "kubernetes.io/cluster/my-cluster".
func clusterNameFromEKSTagKey(key string) string {
	const prefix = "kubernetes.io/cluster/"
	if !strings.HasPrefix(key, prefix) {
		return ""
	}
	name := strings.TrimPrefix(key, prefix)
	if name == "" || strings.Contains(name, "/") {
		return ""
	}
	return name
}

// detectClusterFromCloud tries GKE, AKS, and EKS in parallel within a short budget.
// First success wins; failures are ignored.
func detectClusterFromCloud(ctx context.Context, client httpDoer) string {
	ctx, cancel := context.WithTimeout(ctx, cloudDetectBudget)
	defer cancel()

	type result struct{ name string }
	ch := make(chan result, 3)
	var wg sync.WaitGroup
	run := func(fn func(context.Context, httpDoer) (string, error)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			name, err := fn(ctx, client)
			if err == nil && name != "" {
				ch <- result{name: name}
			}
		}()
	}
	run(clusterNameFromGKE)
	run(clusterNameFromAKS)
	run(clusterNameFromEKS)
	go func() {
		wg.Wait()
		close(ch)
	}()
	for r := range ch {
		if r.name != "" {
			cancel()
			return r.name
		}
	}
	return ""
}
