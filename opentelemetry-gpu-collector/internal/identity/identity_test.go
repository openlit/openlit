package identity

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/attribute"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func testClient(fn roundTripFunc) *http.Client {
	return &http.Client{Transport: fn}
}

func textResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func attrMap(attrs []attribute.KeyValue) map[string]string {
	m := make(map[string]string, len(attrs))
	for _, a := range attrs {
		m[string(a.Key)] = a.Value.AsString()
	}
	return m
}

func TestIsKubernetes(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	if isKubernetes() {
		t.Fatal("expected false when KUBERNETES_SERVICE_HOST unset")
	}
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	if !isKubernetes() {
		t.Fatal("expected true when KUBERNETES_SERVICE_HOST set")
	}
}

func clearIdentityEnv(t *testing.T) {
	t.Helper()
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	t.Setenv("OPENLIT_HOSTNAME", "")
	t.Setenv("HOST_NAME", "")
	t.Setenv("K8S_NODE_NAME", "")
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES_NODE_NAME", "")
	t.Setenv("NODE_NAME", "")
	t.Setenv("K8S_CLUSTER_NAME", "")
	t.Setenv("OPENLIT_K8S_CLUSTER_NAME", "")
	t.Setenv("OPENLIT_K8S_NODE_LOOKUP", "false") // skip real SA token paths in unit tests
}

func TestDetectNonKubernetesSkipsGCEHostname(t *testing.T) {
	clearIdentityEnv(t)

	hostnameProbed := false
	client := testClient(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Path, "/instance/hostname") {
			hostnameProbed = true
			return textResponse(http.StatusOK, "gce-host"), nil
		}
		// IMDS probes for cloud identity are allowed outside K8s; fail soft.
		return textResponse(http.StatusNotFound, ""), nil
	})

	res, _ := detect(context.Background(), discardLogger(), client, func() (string, error) {
		return "os-host", nil
	})
	if hostnameProbed {
		t.Fatal("GCE hostname should not be probed outside Kubernetes")
	}
	if res.HostName != "os-host" {
		t.Fatalf("HostName = %q", res.HostName)
	}
}

func TestDetectNonKubernetesNoCluster(t *testing.T) {
	clearIdentityEnv(t)

	client := testClient(func(req *http.Request) (*http.Response, error) {
		return textResponse(http.StatusNotFound, ""), nil
	})

	res, attrs := detect(context.Background(), discardLogger(), client, func() (string, error) {
		return "my-laptop", nil
	})

	if res.InKubernetes {
		t.Fatal("InKubernetes should be false")
	}
	if res.ClusterName != "" {
		t.Fatalf("ClusterName = %q, want empty", res.ClusterName)
	}
	if res.HostName != "my-laptop" {
		t.Fatalf("HostName = %q, want my-laptop", res.HostName)
	}
	m := attrMap(attrs)
	if m[attrK8sClusterName] != "" {
		t.Fatalf("unexpected k8s.cluster.name attr %q", m[attrK8sClusterName])
	}
	if m[attrHostName] != "my-laptop" {
		t.Fatalf("host.name = %q", m[attrHostName])
	}
}

func TestDetectK8SNodeNameSetsHostAndNode(t *testing.T) {
	clearIdentityEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("K8S_NODE_NAME", "gpu-node-1")
	t.Setenv("NODE_NAME", "legacy-node")

	client := testClient(func(req *http.Request) (*http.Response, error) {
		return textResponse(http.StatusNotFound, ""), nil
	})

	res, attrs := detect(context.Background(), discardLogger(), client, func() (string, error) {
		return "should-not-use", nil
	})

	if res.HostName != "gpu-node-1" || res.NodeName != "gpu-node-1" {
		t.Fatalf("got host=%q node=%q (K8S_NODE_NAME should win over NODE_NAME)", res.HostName, res.NodeName)
	}
	m := attrMap(attrs)
	if m[attrHostName] != "gpu-node-1" || m[attrK8sNodeName] != "gpu-node-1" {
		t.Fatalf("attrs=%v", m)
	}
	if m[attrK8sClusterName] != "" {
		t.Fatalf("cluster should be empty without override/cloud, got %q", m[attrK8sClusterName])
	}
}

func TestDetectOTelOperatorNodeNameEnv(t *testing.T) {
	clearIdentityEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES_NODE_NAME", "operator-node")

	client := testClient(func(req *http.Request) (*http.Response, error) {
		return textResponse(http.StatusNotFound, ""), nil
	})

	res, _ := detect(context.Background(), discardLogger(), client, func() (string, error) {
		return "os", nil
	})
	if res.HostName != "operator-node" || res.NodeName != "operator-node" {
		t.Fatalf("got host=%q node=%q", res.HostName, res.NodeName)
	}
}

func TestDetectLegacyNodeNameFallback(t *testing.T) {
	clearIdentityEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("NODE_NAME", "legacy-node")

	client := testClient(func(req *http.Request) (*http.Response, error) {
		return textResponse(http.StatusNotFound, ""), nil
	})

	res, _ := detect(context.Background(), discardLogger(), client, func() (string, error) {
		return "os", nil
	})
	if res.HostName != "legacy-node" {
		t.Fatalf("HostName = %q", res.HostName)
	}
}

func TestDetectExplicitHostnameBeatsNodeName(t *testing.T) {
	clearIdentityEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("OPENLIT_HOSTNAME", "explicit-host")
	t.Setenv("K8S_NODE_NAME", "gpu-node-1")

	client := testClient(func(req *http.Request) (*http.Response, error) {
		return textResponse(http.StatusNotFound, ""), nil
	})

	res, _ := detect(context.Background(), discardLogger(), client, func() (string, error) {
		return "os", nil
	})
	if res.HostName != "explicit-host" {
		t.Fatalf("HostName = %q", res.HostName)
	}
	if res.NodeName != "gpu-node-1" {
		t.Fatalf("NodeName = %q, want still set from K8S_NODE_NAME", res.NodeName)
	}
}

func TestDetectClusterEnvOverrideBeatsCloud(t *testing.T) {
	clearIdentityEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("K8S_NODE_NAME", "n1")
	t.Setenv("K8S_CLUSTER_NAME", "My_Cluster")

	clusterProbed := false
	client := testClient(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Path, "cluster-name") ||
			strings.Contains(req.URL.Path, "resourceGroupName") ||
			strings.Contains(req.URL.Path, "/meta-data/tags/instance") {
			clusterProbed = true
		}
		return textResponse(http.StatusNotFound, ""), nil
	})

	res, attrs := detect(context.Background(), discardLogger(), client, func() (string, error) {
		return "os", nil
	})
	if res.ClusterName != "my-cluster" {
		t.Fatalf("ClusterName = %q, want my-cluster (normalized)", res.ClusterName)
	}
	if clusterProbed {
		t.Fatal("cluster cloud metadata should not be called when env override is set")
	}
	m := attrMap(attrs)
	if m[attrK8sClusterName] != "my-cluster" {
		t.Fatalf("attrs=%v", m)
	}
}

func TestDetectClusterFromGKE(t *testing.T) {
	clearIdentityEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("K8S_NODE_NAME", "gke-node")

	client := testClient(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Path, "cluster-name") {
			if req.Header.Get("Metadata-Flavor") != "Google" {
				t.Fatalf("missing Metadata-Flavor header")
			}
			return textResponse(http.StatusOK, "prod-gke"), nil
		}
		return textResponse(http.StatusNotFound, ""), nil
	})

	res, _ := detect(context.Background(), discardLogger(), client, func() (string, error) {
		return "os", nil
	})
	if res.ClusterName != "prod-gke" {
		t.Fatalf("ClusterName = %q", res.ClusterName)
	}
}

func TestNormalizeClusterName(t *testing.T) {
	tests := []struct{ in, want string }{
		{"Prod_Cluster", "prod-cluster"},
		{"  already-ok  ", "already-ok"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := normalizeClusterName(tt.in); got != tt.want {
			t.Errorf("normalizeClusterName(%q)=%q want %q", tt.in, got, tt.want)
		}
	}
}

func TestParseAKSClusterName(t *testing.T) {
	tests := []struct{ in, want string }{
		{"MC_MyResourceGroup_example-cluster-name_eastus", "example-cluster-name"},
		{"mc_rg_mycluster_westeurope", "mycluster"},
		{"MC_a_b_c_d_eastus", "d"},
		{"not-mc-group", ""},
		{"MC_short", ""},
	}
	for _, tt := range tests {
		if got := parseAKSClusterName(tt.in); got != tt.want {
			t.Errorf("parseAKSClusterName(%q)=%q want %q", tt.in, got, tt.want)
		}
	}
}

func TestClusterNameFromEKSTagKey(t *testing.T) {
	tests := []struct{ in, want string }{
		{"kubernetes.io/cluster/my-eks", "my-eks"},
		{"kubernetes.io/cluster/", ""},
		{"Name", ""},
		{"kubernetes.io/cluster/a/b", ""},
	}
	for _, tt := range tests {
		if got := clusterNameFromEKSTagKey(tt.in); got != tt.want {
			t.Errorf("clusterNameFromEKSTagKey(%q)=%q want %q", tt.in, got, tt.want)
		}
	}
}

func TestDetectClusterFromAKS(t *testing.T) {
	clearIdentityEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("K8S_NODE_NAME", "aks-node")

	client := testClient(func(req *http.Request) (*http.Response, error) {
		// GKE fails first
		if strings.Contains(req.URL.Path, "attributes/cluster-name") {
			return textResponse(http.StatusNotFound, ""), nil
		}
		if strings.Contains(req.URL.Path, "resourceGroupName") {
			if req.Header.Get("Metadata") != "true" {
				t.Fatal("missing Azure Metadata header")
			}
			return textResponse(http.StatusOK, "MC_MyResourceGroup_aks-prod_eastus"), nil
		}
		return textResponse(http.StatusNotFound, ""), nil
	})

	res, _ := detect(context.Background(), discardLogger(), client, func() (string, error) {
		return "os", nil
	})
	if res.ClusterName != "aks-prod" {
		t.Fatalf("ClusterName = %q, want aks-prod", res.ClusterName)
	}
}

func TestDetectClusterFromEKS(t *testing.T) {
	clearIdentityEnv(t)
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("K8S_NODE_NAME", "eks-node")

	client := testClient(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Path, "attributes/cluster-name") {
			return textResponse(http.StatusNotFound, ""), nil
		}
		if strings.Contains(req.URL.Path, "resourceGroupName") {
			return textResponse(http.StatusNotFound, ""), nil
		}
		if req.Method == http.MethodPut && strings.Contains(req.URL.Path, "/api/token") {
			return textResponse(http.StatusOK, "imds-token"), nil
		}
		if strings.Contains(req.URL.Path, "/meta-data/tags/instance") {
			if req.Header.Get("X-aws-ec2-metadata-token") != "imds-token" {
				t.Fatal("missing IMDS token header")
			}
			return textResponse(http.StatusOK, "Name\nkubernetes.io/cluster/eks-demo\n"), nil
		}
		return textResponse(http.StatusNotFound, ""), nil
	})

	res, _ := detect(context.Background(), discardLogger(), client, func() (string, error) {
		return "os", nil
	})
	if res.ClusterName != "eks-demo" {
		t.Fatalf("ClusterName = %q, want eks-demo", res.ClusterName)
	}
}

func TestDetectIMDSFillsCloudAttrs(t *testing.T) {
	clearIdentityEnv(t)
	doc := `{"instanceType":"g4dn.xlarge","region":"us-east-1","availabilityZone":"us-east-1a","accountId":"123","instanceId":"i-xyz"}`
	client := testClient(func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodPut {
			return textResponse(http.StatusOK, "tok"), nil
		}
		if strings.Contains(req.URL.Path, "instance-identity/document") {
			return textResponse(http.StatusOK, doc), nil
		}
		return textResponse(http.StatusNotFound, ""), nil
	})
	res, attrs := detect(context.Background(), discardLogger(), client, func() (string, error) {
		return "host", nil
	})
	if res.CloudProvider != "aws" || res.HostType != "g4dn.xlarge" || res.CloudRegion != "us-east-1" {
		t.Fatalf("%+v", res)
	}
	if res.HostTypeSource != "imds" {
		t.Fatalf("source=%q", res.HostTypeSource)
	}
	m := attrMap(attrs)
	if m[attrCloudProvider] != "aws" || m[attrHostType] != "g4dn.xlarge" || m[attrHostTypeSource] != "imds" {
		t.Fatalf("%v", m)
	}
}

func TestDetectLogsWithoutPanic(t *testing.T) {
	clearIdentityEnv(t)
	t.Setenv("OPENLIT_HOSTNAME", "h")

	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	client := testClient(func(req *http.Request) (*http.Response, error) {
		return textResponse(http.StatusNotFound, ""), nil
	})
	detect(context.Background(), logger, client, func() (string, error) { return "x", nil })
	if !strings.Contains(buf.String(), "resolved resource identity") {
		t.Fatalf("expected log line, got %q", buf.String())
	}
}
