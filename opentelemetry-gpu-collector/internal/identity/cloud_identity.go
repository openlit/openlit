package identity

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"time"
)

const cloudIdentityBudget = 400 * time.Millisecond

// cloudIMDSEnabled is true unless OPENLIT_CLOUD_DETECT=false.
func cloudIMDSEnabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("OPENLIT_CLOUD_DETECT")))
	return v != "false" && v != "0" && v != "no"
}

// detectCloudIdentityFromIMDS probes AWS/GCP/Azure in parallel and returns the
// first successful deep-fetch. Fast-probe failures are silent (not this cloud).
func detectCloudIdentityFromIMDS(ctx context.Context, client httpDoer) cloudIdentity {
	ctx, cancel := context.WithTimeout(ctx, cloudIdentityBudget)
	defer cancel()

	type result struct {
		ci cloudIdentity
		ok bool
	}
	ch := make(chan result, 3)
	var wg sync.WaitGroup

	run := func(fn func(context.Context, httpDoer) (cloudIdentity, bool)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ci, ok := fn(ctx, client)
			ch <- result{ci: ci, ok: ok}
		}()
	}

	run(imdsAWS)
	run(imdsGCP)
	run(imdsAzure)

	go func() {
		wg.Wait()
		close(ch)
	}()

	for r := range ch {
		if r.ok {
			cancel() // stop siblings
			return r.ci
		}
	}
	return cloudIdentity{}
}

func imdsAWS(ctx context.Context, client httpDoer) (cloudIdentity, bool) {
	headers := map[string]string{}
	token, err := httpPut(ctx, client, ec2IMDSBase+"/api/token", map[string]string{
		"X-aws-ec2-metadata-token-ttl-seconds": "60",
	})
	if err == nil && token != "" {
		headers["X-aws-ec2-metadata-token"] = token
	}

	doc, err := httpGet(ctx, client, ec2IMDSBase+"/dynamic/instance-identity/document", headers)
	if err != nil || doc == "" {
		return cloudIdentity{}, false
	}

	var meta struct {
		InstanceType     string `json:"instanceType"`
		Region           string `json:"region"`
		AvailabilityZone string `json:"availabilityZone"`
		AccountID        string `json:"accountId"`
		InstanceID       string `json:"instanceId"`
	}
	if err := json.Unmarshal([]byte(doc), &meta); err != nil {
		return cloudIdentity{}, false
	}
	if meta.InstanceType == "" && meta.InstanceID == "" {
		return cloudIdentity{}, false
	}

	platform := "aws_ec2"
	if isKubernetes() {
		platform = "aws_eks"
	}
	ci := cloudIdentity{
		Provider:         "aws",
		Platform:         platform,
		HostType:         meta.InstanceType,
		Region:           meta.Region,
		AvailabilityZone: meta.AvailabilityZone,
		AccountID:        meta.AccountID,
		HostID:           meta.InstanceID,
		HostTypeSource:   "imds",
	}
	if ci.HostType == "" {
		ci.HostTypeSource = ""
	}
	return ci, true
}

func imdsGCP(ctx context.Context, client httpDoer) (cloudIdentity, bool) {
	headers := map[string]string{"Metadata-Flavor": "Google"}

	// Fast presence: project-id is cheap and always present on GCE.
	if _, err := httpGet(ctx, client, gceMetadataBase+"/project/project-id", headers); err != nil {
		return cloudIdentity{}, false
	}

	machineType, _ := httpGet(ctx, client, gceMetadataBase+"/instance/machine-type", headers)
	zonePath, _ := httpGet(ctx, client, gceMetadataBase+"/instance/zone", headers)
	instanceID, _ := httpGet(ctx, client, gceMetadataBase+"/instance/id", headers)
	projectID, _ := httpGet(ctx, client, gceMetadataBase+"/project/project-id", headers)

	hostType := basenameAfter(machineType, "machineTypes/")
	zone := basenameAfter(zonePath, "zones/")
	region := regionFromGCPZone(zone)

	platform := "gcp_compute_engine"
	if isKubernetes() {
		platform = "gcp_kubernetes_engine"
	}

	ci := cloudIdentity{
		Provider:         "gcp",
		Platform:         platform,
		HostType:         hostType,
		Region:           region,
		AvailabilityZone: zone,
		AccountID:        projectID,
		HostID:           instanceID,
		HostTypeSource:   "imds",
	}
	if ci.HostType == "" {
		ci.HostTypeSource = ""
	}
	return ci, true
}

func imdsAzure(ctx context.Context, client httpDoer) (cloudIdentity, bool) {
	headers := map[string]string{"Metadata": "true"}
	body, err := httpGet(ctx, client, azureIMDSBase+"/instance/compute?api-version=2021-05-01&format=json", headers)
	if err != nil || body == "" {
		return cloudIdentity{}, false
	}

	var meta struct {
		VMSize         string `json:"vmSize"`
		Location       string `json:"location"`
		Zone           string `json:"zone"`
		SubscriptionID string `json:"subscriptionId"`
		VMID           string `json:"vmId"`
		Name           string `json:"name"`
	}
	if err := json.Unmarshal([]byte(body), &meta); err != nil {
		return cloudIdentity{}, false
	}
	if meta.VMSize == "" && meta.VMID == "" && meta.Name == "" {
		return cloudIdentity{}, false
	}

	platform := "azure_vm"
	if isKubernetes() {
		platform = "azure_aks"
	}
	ci := cloudIdentity{
		Provider:         "azure",
		Platform:         platform,
		HostType:         meta.VMSize, // map vmSize → host.type
		Region:           meta.Location,
		AvailabilityZone: meta.Zone,
		AccountID:        meta.SubscriptionID,
		HostID:           firstNonEmpty(meta.VMID, meta.Name),
		HostTypeSource:   "imds",
	}
	if ci.HostType == "" {
		ci.HostTypeSource = ""
	}
	return ci, true
}

func basenameAfter(path, marker string) string {
	path = strings.TrimSpace(path)
	if i := strings.LastIndex(path, marker); i >= 0 {
		return path[i+len(marker):]
	}
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[i+1:]
	}
	return path
}

func regionFromGCPZone(zone string) string {
	zone = strings.TrimSpace(zone)
	if zone == "" {
		return ""
	}
	// us-central1-a → us-central1
	if i := strings.LastIndex(zone, "-"); i > 0 {
		return zone[:i]
	}
	return zone
}
