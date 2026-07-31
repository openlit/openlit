package config

import (
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Environment        string
	ServiceName        string
	CollectionInterval time.Duration
	EBPFEnabled        bool
	HostMetricsEnabled bool
	FSTypesExclude     []string

	ProcessCmdline         bool
	ProcessCmdlineMaxLen   int
	AllocatedUtilThreshold float64
	K8sPodLookup           bool // in-cluster API (auto on when NODE_NAME set in K8s)
	K8sPodResources        bool // kubelet PodResources socket (default true in K8s)
	InterconnectEnabled    bool
}

func Load() *Config {
	inK8s := os.Getenv("KUBERNETES_SERVICE_HOST") != ""
	nodeName := os.Getenv("K8S_NODE_NAME")
	if nodeName == "" {
		nodeName = os.Getenv("NODE_NAME")
	}
	// Pod API lookup auto-enables in-cluster when the node name is known.
	defaultPodLookup := inK8s && nodeName != ""
	// eBPF is Linux-only; default on there (soft-fails without BPF caps; CUDA
	// libs are discovered via FS + /proc maps). Off on Windows/macOS.
	defaultEBPF := runtime.GOOS == "linux"
	cfg := &Config{
		ServiceName: envOrDefault("OTEL_SERVICE_NAME", "default"),
		// OTEL_METRIC_EXPORT_INTERVAL is in milliseconds per the OTel spec.
		// OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS, and
		// OTEL_EXPORTER_OTLP_PROTOCOL are read directly by the OTel SDK exporters.
		CollectionInterval: parseIntervalMS(os.Getenv("OTEL_METRIC_EXPORT_INTERVAL"), 60*time.Second),
		EBPFEnabled:        parseBool(envOrDefault("OTEL_GPU_EBPF_ENABLED", strconv.FormatBool(defaultEBPF))),
		HostMetricsEnabled: parseBool(envOrDefault("OPENLIT_HOST_METRICS", "true")),
		// Filesystem types excluded from system.filesystem.* (comma-separated).
		// The defaults are image-based filesystems packed at creation: they
		// report zero free blocks by definition, so their utilization is 100%
		// forever and carries no signal. Snap squashfs mounts additionally get
		// a fresh mountpoint (= fresh time series) on every refresh. cd9660 is
		// the macOS/BSD ISO 9660 driver; CDFS and UDF are the Windows optical
		// media drivers (Windows reports filesystem types in uppercase). Set
		// the variable to an empty string to report every mounted filesystem;
		// the default applies only when it is unset.
		FSTypesExclude: parseList(lookupEnvOrDefault("OTEL_GPU_FS_TYPES_EXCLUDE", "squashfs,erofs,iso9660,cramfs,romfs,cd9660,CDFS,UDF")),

		ProcessCmdline:         parseBool(envOrDefault("OTEL_GPU_PROCESS_CMDLINE", "true")),
		ProcessCmdlineMaxLen:   parseInt(envOrDefault("OTEL_GPU_PROCESS_CMDLINE_MAX_LEN", "512"), 512),
		AllocatedUtilThreshold: parseFloat(envOrDefault("OTEL_GPU_ALLOCATED_UTIL_THRESHOLD", "0.05"), 0.05),
		K8sPodLookup:           parseBool(envOrDefault("OPENLIT_K8S_POD_LOOKUP", strconv.FormatBool(defaultPodLookup))),
		K8sPodResources:        parseBool(envOrDefault("OPENLIT_K8S_POD_RESOURCES", strconv.FormatBool(inK8s))),
		InterconnectEnabled:    parseBool(envOrDefault("OTEL_GPU_INTERCONNECT_ENABLED", "true")),
	}

	// deployment.environment comes from OTEL_RESOURCE_ATTRIBUTES per the OTel spec.
	cfg.Environment = parseResourceAttr(os.Getenv("OTEL_RESOURCE_ATTRIBUTES"), "deployment.environment", "default")

	return cfg
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// lookupEnvOrDefault returns the value of key if it is set — even if set to
// the empty string — and fallback only when the variable is unset.
func lookupEnvOrDefault(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

// parseIntervalMS parses OTEL_METRIC_EXPORT_INTERVAL which is specified in milliseconds.
func parseIntervalMS(s string, fallback time.Duration) time.Duration {
	if s == "" {
		return fallback
	}
	ms, err := strconv.ParseInt(s, 10, 64)
	if err != nil || ms <= 0 {
		return fallback
	}
	return time.Duration(ms) * time.Millisecond
}

// parseList parses a comma-separated string into its non-empty trimmed items.
func parseList(s string) []string {
	var out []string
	for _, item := range strings.Split(s, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func parseBool(s string) bool {
	b, _ := strconv.ParseBool(s)
	return b
}

func parseInt(s string, fallback int) int {
	v, err := strconv.Atoi(s)
	if err != nil || v <= 0 {
		return fallback
	}
	return v
}

func parseFloat(s string, fallback float64) float64 {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || v < 0 {
		return fallback
	}
	return v
}

// parseResourceAttr extracts a specific key from OTEL_RESOURCE_ATTRIBUTES format
// "key1=val1,key2=val2".
func parseResourceAttr(raw, key, fallback string) string {
	if raw == "" {
		return fallback
	}
	for _, pair := range strings.Split(raw, ",") {
		kv := strings.SplitN(strings.TrimSpace(pair), "=", 2)
		if len(kv) == 2 && strings.TrimSpace(kv[0]) == key {
			return strings.TrimSpace(kv[1])
		}
	}
	return fallback
}
