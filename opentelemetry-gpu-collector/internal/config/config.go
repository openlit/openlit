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

	// DCGM (optional NVIDIA datacenter profiling).
	DCGMEnabled  bool
	DCGMLibPath  string
	DCGMAddress  string // empty = embedded; else hostengine addr
	DCGMFields   string
	DCGMInterval time.Duration
	DCGMPrefer   bool // prefer DCGM over NVML for overlapping series

	// Kineto on-demand profiling.
	KinetoEnabled  bool
	KinetoTraceDir string
	KinetoSocket   string

	// Per-NIC / RDMA hardware metrics.
	NICEnabled           bool
	RDMAEnabled          bool
	RDMACounters         []string
	NetInterfaces        []string // allow list; empty = all non-excluded
	NetInterfaceExclude  []string

	// CPU PMU.
	PMUEnabled bool
	PMUEvents  []string

	// TPU scrape.
	TPUEnabled         bool
	TPUEndpoint        string
	TPUScrapeTimeoutMS int
	TPUMetricAllowlist []string

	// KVM + interrupts.
	KVMEnabled           bool
	InterruptsEnabled    bool
	InterruptsPerCPU     bool

	// AMD RDC.
	RDCEnabled bool
	RDCLibPath string

	// Export / control plane.
	PrometheusAddr     string // empty = disabled
	ControlAddr        string // empty = disabled
	ControlToken       string
	ControlAllowRemote bool // when true + non-empty token, allow non-loopback bind

	// On-demand Intel PT (via control API).
	IntelPTEnabled        bool
	IntelPTMaxDurationMS  int
	IntelPTMaxBufferPages int
	IntelPTMaxCPUs        int
	IntelPTOutputDir      string

	// High-resolution CPU sampling.
	CPUHighRes bool

	// CollectorMode is the resolved OTEL_GPU_COLLECTOR_MODE preset (all|light|serving|training|deep).
	CollectorMode string
	// ModeInvalid is true when the env mode was unrecognized (fell back to all).
	ModeInvalid bool
}

func Load() *Config {
	inK8s := os.Getenv("KUBERNETES_SERVICE_HOST") != ""
	nodeName := os.Getenv("K8S_NODE_NAME")
	if nodeName == "" {
		nodeName = os.Getenv("NODE_NAME")
	}
	defaultPodLookup := inK8s && nodeName != ""

	mode, modeOK := ResolveMode(os.Getenv("OTEL_GPU_COLLECTOR_MODE"))
	p := presetFor(mode)

	defaultEBPF := p.ebpf
	if runtime.GOOS != "linux" {
		defaultEBPF = false
	}

	pmuEventFallback := "instructions,cycles"
	if p.pmu && p.pmuEvents != "" {
		pmuEventFallback = p.pmuEvents
	}

	cfg := &Config{
		CollectorMode: mode,
		ModeInvalid:   !modeOK,

		ServiceName: envIfSet("OTEL_SERVICE_NAME"),
		// OTEL_METRIC_EXPORT_INTERVAL is in milliseconds per the OTel spec.
		CollectionInterval: parseIntervalMS(os.Getenv("OTEL_METRIC_EXPORT_INTERVAL"), 60*time.Second),
		EBPFEnabled:        boolFromEnvOr("OTEL_GPU_EBPF_ENABLED", defaultEBPF),
		HostMetricsEnabled: boolFromEnvOr("OPENLIT_HOST_METRICS", true),
		FSTypesExclude:     parseList(lookupEnvOrDefault("OTEL_GPU_FS_TYPES_EXCLUDE", "squashfs,erofs,iso9660,cramfs,romfs,cd9660,CDFS,UDF")),

		ProcessCmdline:         boolFromEnvOr("OTEL_GPU_PROCESS_CMDLINE", true),
		ProcessCmdlineMaxLen:   parseInt(envOrDefault("OTEL_GPU_PROCESS_CMDLINE_MAX_LEN", "512"), 512),
		AllocatedUtilThreshold: parseFloat(envOrDefault("OTEL_GPU_ALLOCATED_UTIL_THRESHOLD", "0.05"), 0.05),
		K8sPodLookup:           boolFromEnvOr("OPENLIT_K8S_POD_LOOKUP", defaultPodLookup),
		K8sPodResources:        boolFromEnvOr("OPENLIT_K8S_POD_RESOURCES", inK8s),
		InterconnectEnabled:    boolFromEnvOr("OTEL_GPU_INTERCONNECT_ENABLED", true),

		DCGMEnabled:  boolFromEnvOr("OTEL_GPU_DCGM_ENABLED", p.dcgm),
		DCGMLibPath:  envOrDefault("OTEL_GPU_DCGM_LIB_PATH", "/lib64/libdcgm.so"),
		DCGMAddress:  os.Getenv("OTEL_GPU_DCGM_ADDRESS"),
		// Default DCGM fields: identity, SM clock, power, GPU/mem util, DCP prof 1001–1012.
		// 155=POWER_USAGE, 203=GPU_UTIL, 204=MEM_COPY_UTIL.
		DCGMFields:   envOrDefault("OTEL_GPU_DCGM_FIELDS", "50,100,155,203,204,1001,1002,1003,1004,1005,1006,1007,1008,1009,1010,1011,1012"),
		DCGMInterval: parseIntervalSec(envOrDefault("OTEL_GPU_DCGM_INTERVAL", "10"), 10*time.Second),
		DCGMPrefer:   boolFromEnvOr("OTEL_GPU_DCGM_PREFER", p.dcgmPrefer),

		KinetoEnabled:  boolFromEnvOr("OTEL_GPU_KINETO_ENABLED", p.kineto),
		KinetoTraceDir: envOrDefault("OTEL_GPU_KINETO_TRACE_DIR", "/tmp"),
		KinetoSocket:   envOrDefault("OTEL_GPU_KINETO_SOCKET", "/tmp/libkineto_unixsocket"),

		NICEnabled:          boolFromEnvOr("OTEL_HOST_NIC_ENABLED", p.nic),
		RDMAEnabled:         boolFromEnvOr("OTEL_HOST_RDMA_ENABLED", p.rdma),
		RDMACounters:        parseList(os.Getenv("OTEL_HOST_RDMA_COUNTERS")),
		NetInterfaces:       parseList(os.Getenv("OTEL_HOST_NET_INTERFACES")),
		NetInterfaceExclude: parseList(lookupEnvOrDefault("OTEL_HOST_NET_INTERFACE_EXCLUDE", "lo,lo0")),

		PMUEnabled: boolFromEnvOr("OTEL_HOST_PMU_ENABLED", p.pmu),
		PMUEvents:  parseList(lookupEnvOrDefault("OTEL_HOST_PMU_EVENTS", pmuEventFallback)),

		TPUEnabled:         boolFromEnvOr("OTEL_TPU_ENABLED", p.tpu),
		TPUEndpoint:        envOrDefault("OTEL_TPU_ENDPOINT", "http://127.0.0.1:2112/metrics"),
		TPUScrapeTimeoutMS: parseInt(envOrDefault("OTEL_TPU_SCRAPE_TIMEOUT_MS", "2000"), 2000),
		TPUMetricAllowlist: parseList(lookupEnvOrDefault("OTEL_TPU_METRIC_ALLOWLIST", "duty_cycle,tensorcore_utilization,memory_total,memory_used,memory_bandwidth_utilization")),

		KVMEnabled:        boolFromEnvOr("OTEL_HOST_KVM_ENABLED", p.kvm),
		InterruptsEnabled: boolFromEnvOr("OTEL_HOST_INTERRUPTS_ENABLED", p.interrupts),
		InterruptsPerCPU:  boolFromEnvOr("OTEL_HOST_INTERRUPTS_PER_CPU", false),

		RDCEnabled: boolFromEnvOr("OTEL_GPU_RDC_ENABLED", p.rdc),
		RDCLibPath: envOrDefault("OTEL_GPU_RDC_LIB_PATH", "librdc.so"),

		PrometheusAddr:     os.Getenv("OTEL_GPU_PROMETHEUS_ADDR"),
		ControlAddr:        stringFromEnvOr("OTEL_GPU_CONTROL_ADDR", p.controlAddr),
		ControlToken:       os.Getenv("OTEL_GPU_CONTROL_TOKEN"),
		ControlAllowRemote: boolFromEnvOr("OTEL_GPU_CONTROL_ALLOW_REMOTE", false),

		IntelPTEnabled:        boolFromEnvOr("OTEL_HOST_INTEL_PT_ENABLED", p.intelPT),
		IntelPTMaxDurationMS:  parseInt(envOrDefault("OTEL_HOST_INTEL_PT_MAX_DURATION_MS", "2000"), 2000),
		IntelPTMaxBufferPages: parseInt(envOrDefault("OTEL_HOST_INTEL_PT_MAX_BUFFER_PAGES", "64"), 64),
		IntelPTMaxCPUs:        parseInt(envOrDefault("OTEL_HOST_INTEL_PT_MAX_CPUS", "4"), 4),
		IntelPTOutputDir:      envOrDefault("OTEL_HOST_INTEL_PT_OUTPUT_DIR", "/tmp"),

		CPUHighRes: boolFromEnvOr("OTEL_HOST_CPU_HIGHRES", p.cpuHighRes),
	}

	cfg.Environment = parseResourceAttr(os.Getenv("OTEL_RESOURCE_ATTRIBUTES"), "deployment.environment", "default")

	return cfg
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// envIfSet returns the env value when set and non-empty; otherwise "".
func envIfSet(key string) string {
	if v, ok := os.LookupEnv(key); ok {
		return strings.TrimSpace(v)
	}
	return ""
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

// parseIntervalSec parses an interval specified in whole seconds.
func parseIntervalSec(s string, fallback time.Duration) time.Duration {
	if s == "" {
		return fallback
	}
	sec, err := strconv.ParseInt(s, 10, 64)
	if err != nil || sec <= 0 {
		return fallback
	}
	return time.Duration(sec) * time.Second
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
