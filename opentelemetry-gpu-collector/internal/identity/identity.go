package identity

import (
	"context"
	"log/slog"
	"os"
	"strings"

	"go.opentelemetry.io/otel/attribute"
)

const (
	attrHostName              = "host.name"
	attrK8sNodeName           = "k8s.node.name"
	attrK8sClusterName        = "k8s.cluster.name"
	attrCloudProvider         = "cloud.provider"
	attrCloudPlatform         = "cloud.platform"
	attrHostType              = "host.type"
	attrCloudRegion           = "cloud.region"
	attrCloudAvailabilityZone = "cloud.availability_zone"
	attrCloudAccountID        = "cloud.account.id"
	attrHostID                = "host.id"
	attrHostTypeSource        = "openlit.host.type.source"
)

// Result holds resolved host / Kubernetes / cloud identity for logging and tests.
type Result struct {
	HostName         string
	NodeName         string
	ClusterName      string
	InKubernetes     bool
	CloudProvider    string
	CloudPlatform    string
	HostType         string
	CloudRegion      string
	AvailabilityZone string
	CloudAccountID   string
	HostID           string
	HostTypeSource   string
}

// Detect resolves host, Kubernetes, and cloud instance identity.
//
// Hostname / node precedence:
//  1. Explicit OPENLIT_HOSTNAME / HOST_NAME (optional override)
//  2. K8S_NODE_NAME → OTEL_RESOURCE_ATTRIBUTES_NODE_NAME → NODE_NAME (downward API)
//  3. (K8s only) GCE hostname
//  4. OS hostname
//
// Cluster name (K8s only): K8S_CLUSTER_NAME / OPENLIT_K8S_CLUSTER_NAME → GKE/AKS/EKS metadata.
//
// Cloud / instance type (fill missing fields only):
//  1. Explicit OTEL_RESOURCE_ATTRIBUTES (applied after Detect via WithFromEnv)
//  2. K8s Node GET (providerID + labels) when in-cluster
//  3. Parallel AWS/GCP/Azure IMDS
//  4. DMI sys_vendor hint (provider only)
//
// Prefer the OpenTelemetry pattern: set attributes via OTEL_RESOURCE_ATTRIBUTES
// (applied after Detect via resource.WithFromEnv(), so it wins over auto-detect).
func Detect(ctx context.Context, logger *slog.Logger) (Result, []attribute.KeyValue) {
	return detect(ctx, logger, defaultHTTPClient(), osHostname)
}

func detect(
	ctx context.Context,
	logger *slog.Logger,
	client httpDoer,
	osHostnameFn func() (string, error),
) (Result, []attribute.KeyValue) {
	if logger == nil {
		logger = slog.Default()
	}

	res := Result{
		InKubernetes: isKubernetes(),
	}

	res.HostName, res.NodeName = resolveHostname(ctx, client, osHostnameFn, res.InKubernetes)

	if res.InKubernetes {
		res.ClusterName = resolveClusterName(ctx, client)
	}

	applyCloudIdentity(&res, resolveCloudIdentity(ctx, client, logger, res.InKubernetes, res.NodeName))

	attrs := resultAttrs(res)

	logger.Info("resolved resource identity",
		"host.name", res.HostName,
		"k8s.node.name", res.NodeName,
		"k8s.cluster.name", emptyAs(res.ClusterName, "not detected"),
		"cloud.provider", emptyAs(res.CloudProvider, "not detected"),
		"host.type", emptyAs(res.HostType, "not detected"),
		"cloud.region", emptyAs(res.CloudRegion, "not detected"),
		"host.type.source", emptyAs(res.HostTypeSource, ""),
		"kubernetes", res.InKubernetes,
	)

	return res, attrs
}

func emptyAs(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

func resultAttrs(res Result) []attribute.KeyValue {
	attrs := make([]attribute.KeyValue, 0, 12)
	if res.HostName != "" {
		attrs = append(attrs, attribute.String(attrHostName, res.HostName))
	}
	if res.NodeName != "" {
		attrs = append(attrs, attribute.String(attrK8sNodeName, res.NodeName))
	}
	if res.ClusterName != "" {
		attrs = append(attrs, attribute.String(attrK8sClusterName, res.ClusterName))
	}
	if res.CloudProvider != "" {
		attrs = append(attrs, attribute.String(attrCloudProvider, res.CloudProvider))
	}
	if res.CloudPlatform != "" {
		attrs = append(attrs, attribute.String(attrCloudPlatform, res.CloudPlatform))
	}
	if res.HostType != "" {
		attrs = append(attrs, attribute.String(attrHostType, res.HostType))
	}
	if res.CloudRegion != "" {
		attrs = append(attrs, attribute.String(attrCloudRegion, res.CloudRegion))
	}
	if res.AvailabilityZone != "" {
		attrs = append(attrs, attribute.String(attrCloudAvailabilityZone, res.AvailabilityZone))
	}
	if res.CloudAccountID != "" {
		attrs = append(attrs, attribute.String(attrCloudAccountID, res.CloudAccountID))
	}
	if res.HostID != "" {
		attrs = append(attrs, attribute.String(attrHostID, res.HostID))
	}
	if res.HostTypeSource != "" {
		attrs = append(attrs, attribute.String(attrHostTypeSource, res.HostTypeSource))
	}
	return attrs
}

func applyCloudIdentity(res *Result, ci cloudIdentity) {
	if res.CloudProvider == "" {
		res.CloudProvider = ci.Provider
	}
	if res.CloudPlatform == "" {
		res.CloudPlatform = ci.Platform
	}
	if res.HostType == "" {
		res.HostType = ci.HostType
		if ci.HostType != "" {
			res.HostTypeSource = ci.HostTypeSource
		}
	} else if res.HostTypeSource == "" && ci.HostTypeSource != "" {
		res.HostTypeSource = ci.HostTypeSource
	}
	if res.CloudRegion == "" {
		res.CloudRegion = ci.Region
	}
	if res.AvailabilityZone == "" {
		res.AvailabilityZone = ci.AvailabilityZone
	}
	if res.CloudAccountID == "" {
		res.CloudAccountID = ci.AccountID
	}
	if res.HostID == "" {
		res.HostID = ci.HostID
	}
}

// resolveCloudIdentity fills cloud attrs: K8s node → IMDS → DMI.
// Only later tiers fill fields still empty (mergeCloud).
func resolveCloudIdentity(ctx context.Context, client httpDoer, logger *slog.Logger, inK8s bool, nodeName string) cloudIdentity {
	var out cloudIdentity

	if inK8s && nodeName != "" {
		info, err := fetchNodeCloudInfo(ctx, nodeName)
		if err != nil {
			logger.Debug("k8s node cloud lookup failed", "error", err)
		} else if info != nil {
			out = mergeCloud(out, cloudIdentityFromNode(info))
		}
	}

	if cloudIncomplete(out) && cloudIMDSEnabled() {
		out = mergeCloud(out, detectCloudIdentityFromIMDS(ctx, client))
	}

	if out.Provider == "" {
		out = mergeCloud(out, cloudProviderFromDMI())
	}

	return out
}

func cloudIncomplete(ci cloudIdentity) bool {
	return ci.Provider == "" || ci.HostType == "" || ci.Region == ""
}

// mergeCloud copies non-empty fields from src into dst without overwriting.
func mergeCloud(dst, src cloudIdentity) cloudIdentity {
	if dst.Provider == "" {
		dst.Provider = src.Provider
	}
	if dst.Platform == "" {
		dst.Platform = src.Platform
	}
	if dst.HostType == "" {
		dst.HostType = src.HostType
		if src.HostTypeSource != "" {
			dst.HostTypeSource = src.HostTypeSource
		}
	}
	if dst.Region == "" {
		dst.Region = src.Region
	}
	if dst.AvailabilityZone == "" {
		dst.AvailabilityZone = src.AvailabilityZone
	}
	if dst.AccountID == "" {
		dst.AccountID = src.AccountID
	}
	if dst.HostID == "" {
		dst.HostID = src.HostID
	}
	return dst
}

func isKubernetes() bool {
	return os.Getenv("KUBERNETES_SERVICE_HOST") != ""
}

func resolveHostname(ctx context.Context, client httpDoer, osHostnameFn func() (string, error), inKubernetes bool) (hostName, nodeName string) {
	nodeName = downwardNodeName()

	if v := firstNonEmpty(os.Getenv("OPENLIT_HOSTNAME"), os.Getenv("HOST_NAME")); v != "" {
		return v, nodeName
	}

	if nodeName != "" {
		return nodeName, nodeName
	}

	// Only probe GCE when in Kubernetes (e.g. GKE without downward API).
	// Outside K8s, OS hostname is fine and avoids a metadata timeout on every start.
	if inKubernetes {
		if gceHost, err := hostnameFromGCE(ctx, client); err == nil && gceHost != "" {
			return gceHost, ""
		}
	}

	if osHostnameFn != nil {
		if hn, err := osHostnameFn(); err == nil && hn != "" {
			return hn, ""
		}
	}
	return "", ""
}

// downwardNodeName reads the Kubernetes node name from common downward-API env vars.
// Prefer OTel-aligned names; NODE_NAME remains a legacy fallback.
func downwardNodeName() string {
	return firstNonEmpty(
		os.Getenv("K8S_NODE_NAME"),
		os.Getenv("OTEL_RESOURCE_ATTRIBUTES_NODE_NAME"),
		os.Getenv("NODE_NAME"),
	)
}

func resolveClusterName(ctx context.Context, client httpDoer) string {
	// Prefer K8S_CLUSTER_NAME (common in OTel manifests); OPENLIT_* is an alias.
	if v := firstNonEmpty(os.Getenv("K8S_CLUSTER_NAME"), os.Getenv("OPENLIT_K8S_CLUSTER_NAME")); v != "" {
		return normalizeClusterName(v)
	}
	if name := detectClusterFromCloud(ctx, client); name != "" {
		return normalizeClusterName(name)
	}
	return ""
}

// normalizeClusterName lowercases and replaces underscores with hyphens (RFC1123-ish).
func normalizeClusterName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	name = strings.ToLower(name)
	name = strings.ReplaceAll(name, "_", "-")
	return name
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

func osHostname() (string, error) {
	return os.Hostname()
}
