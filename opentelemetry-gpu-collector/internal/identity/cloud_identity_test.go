package identity

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestProviderFromProviderID(t *testing.T) {
	tests := []struct {
		id, kv       string
		wantProvider string
		wantPlatform string
	}{
		{"aws:///us-east-1a/i-0abc", "", "aws", "aws_eks"},
		{"gce://my-proj/us-central1-a/node-1", "", "gcp", "gcp_kubernetes_engine"},
		{"azure:///subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1", "", "azure", "azure_aks"},
		{"ocid1.instance.oc1..aaaa", "", "oracle_cloud", "oracle_cloud_oke"},
		{"", "v1.28.0-eks-abc", "aws", "aws_eks"},
		{"", "v1.28.0", "", ""},
	}
	for _, tt := range tests {
		p, plat := providerFromProviderID(tt.id, tt.kv, nil)
		if p != tt.wantProvider || plat != tt.wantPlatform {
			t.Errorf("id=%q kv=%q → %q/%q want %q/%q", tt.id, tt.kv, p, plat, tt.wantProvider, tt.wantPlatform)
		}
	}
}

func TestHostIDFromProviderID(t *testing.T) {
	tests := []struct {
		id, want string
	}{
		{"aws:///us-east-1a/i-0fea4fd46592d050b", "i-0fea4fd46592d050b"},
		{"gce://guestbook-12345/us-central1-a/gke-node-1", "gke-node-1"},
		{"azure:///subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/myvm", "myvm"},
		{"azure:///subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachineScaleSets/myvmss/virtualMachines/0", "myvmss/0"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := hostIDFromProviderID(tt.id); got != tt.want {
			t.Errorf("hostIDFromProviderID(%q)=%q want %q", tt.id, got, tt.want)
		}
	}
}

func TestInstanceTypeFromLabels(t *testing.T) {
	got := instanceTypeFromLabels(map[string]string{
		labelInstanceTypeStable: "g4dn.xlarge",
	})
	if got != "g4dn.xlarge" {
		t.Fatalf("got %q", got)
	}
	got = instanceTypeFromLabels(map[string]string{
		labelInstanceTypeBeta: "Standard_NC6s_v3",
	})
	if got != "Standard_NC6s_v3" {
		t.Fatalf("beta got %q", got)
	}
	got = instanceTypeFromLabels(map[string]string{
		labelInstanceTypeStable: "k3s",
	})
	if got != "" {
		t.Fatalf("k3s should be rejected, got %q", got)
	}
}

func TestParseNodeCloudJSON(t *testing.T) {
	raw := `{
		"metadata": {
			"labels": {
				"node.kubernetes.io/instance-type": "g5.xlarge",
				"topology.kubernetes.io/region": "us-west-2",
				"topology.kubernetes.io/zone": "us-west-2b"
			}
		},
		"spec": {"providerID": "aws:///us-west-2b/i-0123456789abcdef0"},
		"status": {"nodeInfo": {"kubeletVersion": "v1.29.0-eks-1"}}
	}`
	info, err := parseNodeCloudJSON([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	ci := cloudIdentityFromNode(info)
	if ci.Provider != "aws" || ci.HostType != "g5.xlarge" || ci.Region != "us-west-2" {
		t.Fatalf("ci=%+v", ci)
	}
	if ci.HostID != "i-0123456789abcdef0" {
		t.Fatalf("HostID=%q", ci.HostID)
	}
	if ci.HostTypeSource != "k8s_label" {
		t.Fatalf("source=%q", ci.HostTypeSource)
	}
	if ci.AvailabilityZone != "us-west-2b" {
		t.Fatalf("zone=%q", ci.AvailabilityZone)
	}
}

func TestValidInstanceType(t *testing.T) {
	if !validInstanceType("n1-standard-8") {
		t.Fatal("n1-standard-8")
	}
	if !validInstanceType("p5.48xlarge") {
		t.Fatal("p5")
	}
	if validInstanceType("k3s") || validInstanceType("unknown") || validInstanceType("") {
		t.Fatal("should reject")
	}
}

func TestIMDSAWSIdentityDocument(t *testing.T) {
	doc, _ := json.Marshal(map[string]string{
		"instanceType":     "g4dn.xlarge",
		"region":           "us-east-1",
		"availabilityZone": "us-east-1a",
		"accountId":        "123456789012",
		"instanceId":       "i-abc",
	})
	client := testClient(func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodPut && strings.Contains(req.URL.Path, "/api/token") {
			return textResponse(http.StatusOK, "tok"), nil
		}
		if strings.Contains(req.URL.Path, "instance-identity/document") {
			if req.Header.Get("X-aws-ec2-metadata-token") != "tok" {
				t.Fatal("expected IMDSv2 token")
			}
			return textResponse(http.StatusOK, string(doc)), nil
		}
		return textResponse(http.StatusNotFound, ""), nil
	})

	ci, ok := imdsAWS(context.Background(), client)
	if !ok {
		t.Fatal("expected ok")
	}
	if ci.Provider != "aws" || ci.HostType != "g4dn.xlarge" || ci.Region != "us-east-1" {
		t.Fatalf("%+v", ci)
	}
	if ci.HostTypeSource != "imds" {
		t.Fatalf("source=%q", ci.HostTypeSource)
	}
}

func TestIMDSGCPMachineType(t *testing.T) {
	client := testClient(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get("Metadata-Flavor") != "Google" {
			return textResponse(http.StatusForbidden, ""), nil
		}
		switch {
		case strings.HasSuffix(req.URL.Path, "/project/project-id"):
			return textResponse(http.StatusOK, "my-proj"), nil
		case strings.HasSuffix(req.URL.Path, "/instance/machine-type"):
			return textResponse(http.StatusOK, "projects/123/machineTypes/a2-highgpu-1g"), nil
		case strings.HasSuffix(req.URL.Path, "/instance/zone"):
			return textResponse(http.StatusOK, "projects/123/zones/us-central1-a"), nil
		case strings.HasSuffix(req.URL.Path, "/instance/id"):
			return textResponse(http.StatusOK, "9876543210"), nil
		default:
			return textResponse(http.StatusNotFound, ""), nil
		}
	})
	ci, ok := imdsGCP(context.Background(), client)
	if !ok {
		t.Fatal("expected ok")
	}
	if ci.HostType != "a2-highgpu-1g" || ci.Region != "us-central1" || ci.AvailabilityZone != "us-central1-a" {
		t.Fatalf("%+v", ci)
	}
	if ci.Provider != "gcp" || ci.AccountID != "my-proj" {
		t.Fatalf("%+v", ci)
	}
}

func TestIMDSAzureVMSize(t *testing.T) {
	body := `{"vmSize":"Standard_NC6s_v3","location":"eastus","zone":"1","subscriptionId":"sub-1","vmId":"vm-guid","name":"node1"}`
	client := testClient(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get("Metadata") != "true" {
			return textResponse(http.StatusBadRequest, ""), nil
		}
		if !strings.Contains(req.URL.RawQuery, "api-version=2021-05-01") {
			t.Fatalf("query=%s", req.URL.RawQuery)
		}
		return textResponse(http.StatusOK, body), nil
	})
	ci, ok := imdsAzure(context.Background(), client)
	if !ok {
		t.Fatal("expected ok")
	}
	if ci.Provider != "azure" || ci.HostType != "Standard_NC6s_v3" || ci.Region != "eastus" {
		t.Fatalf("%+v", ci)
	}
}

func TestDetectCloudIdentityParallelFirstWins(t *testing.T) {
	client := testClient(func(req *http.Request) (*http.Response, error) {
		// Only AWS succeeds
		if req.Method == http.MethodPut {
			return textResponse(http.StatusOK, "t"), nil
		}
		if strings.Contains(req.URL.Path, "instance-identity/document") {
			return textResponse(http.StatusOK, `{"instanceType":"m5.large","region":"eu-west-1","instanceId":"i-1","accountId":"1","availabilityZone":"eu-west-1a"}`), nil
		}
		return textResponse(http.StatusNotFound, ""), nil
	})
	ci := detectCloudIdentityFromIMDS(context.Background(), client)
	if ci.Provider != "aws" || ci.HostType != "m5.large" {
		t.Fatalf("%+v", ci)
	}
}

func TestMergeCloudDoesNotOverwrite(t *testing.T) {
	dst := cloudIdentity{Provider: "aws", HostType: "g5.xlarge", HostTypeSource: "k8s_label"}
	src := cloudIdentity{Provider: "gcp", HostType: "n1-standard-1", Region: "us-central1", HostTypeSource: "imds"}
	got := mergeCloud(dst, src)
	if got.Provider != "aws" || got.HostType != "g5.xlarge" || got.HostTypeSource != "k8s_label" {
		t.Fatalf("%+v", got)
	}
	if got.Region != "us-central1" {
		t.Fatalf("region should fill: %+v", got)
	}
}

func TestK8sNodeLookupDisabled(t *testing.T) {
	t.Setenv("OPENLIT_K8S_NODE_LOOKUP", "false")
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	info, err := fetchNodeCloudInfo(context.Background(), "node-1")
	if err != nil || info != nil {
		t.Fatalf("expected skip, got %+v %v", info, err)
	}
}

func TestRegionFromGCPZone(t *testing.T) {
	if got := regionFromGCPZone("us-central1-a"); got != "us-central1" {
		t.Fatalf("%q", got)
	}
}
