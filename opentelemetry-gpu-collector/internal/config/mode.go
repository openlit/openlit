package config

import (
	"log/slog"
	"os"
	"runtime"
	"strings"
)

// Collector mode names for OTEL_GPU_COLLECTOR_MODE.
const (
	ModeAll      = "all"
	ModeLight    = "light"
	ModeServing  = "serving"
	ModeTraining = "training"
	ModeDeep     = "deep"

	DefaultControlAddr = "127.0.0.1:1919"
	DefaultPMUEvents   = "instructions,cycles,memory_bandwidth"
)

// ResolveMode normalizes the mode string. Empty → all. Invalid → all + ok=false.
func ResolveMode(raw string) (mode string, ok bool) {
	m := strings.ToLower(strings.TrimSpace(raw))
	if m == "" {
		return ModeAll, true
	}
	switch m {
	case ModeAll, ModeLight, ModeServing, ModeTraining, ModeDeep:
		return m, true
	default:
		return ModeAll, false
	}
}

type modePreset struct {
	ebpf        bool // only applied on linux
	dcgm        bool
	dcgmPrefer  bool
	rdc         bool
	nic         bool
	rdma        bool
	pmu         bool
	tpu         bool
	kvm         bool
	interrupts  bool
	kineto      bool
	intelPT     bool
	cpuHighRes  bool
	controlAddr string // empty = leave unset / disabled
	pmuEvents   string // applied only when PMU env unset and pmu true
}

func presetFor(mode string) modePreset {
	linux := runtime.GOOS == "linux"
	switch mode {
	case ModeLight:
		return modePreset{}
	case ModeServing:
		return modePreset{
			ebpf:       linux,
			dcgm:       true,
			dcgmPrefer: true,
		}
	case ModeTraining:
		return modePreset{
			ebpf:       linux,
			dcgm:       true,
			dcgmPrefer: true,
			nic:        true,
			rdma:       true,
			pmu:        true,
			pmuEvents:  DefaultPMUEvents,
		}
	case ModeDeep:
		return modePreset{
			ebpf:        linux,
			dcgm:        true,
			dcgmPrefer:  true,
			nic:         true,
			rdma:        true,
			pmu:         true,
			pmuEvents:   DefaultPMUEvents,
			kineto:      true,
			intelPT:     true,
			cpuHighRes:  true,
			controlAddr: DefaultControlAddr,
		}
	default: // ModeAll
		return modePreset{
			ebpf:        linux,
			dcgm:        true,
			dcgmPrefer:  true,
			rdc:         true,
			nic:         true,
			rdma:        true,
			pmu:         true,
			pmuEvents:   DefaultPMUEvents,
			tpu:         true,
			kvm:         true,
			interrupts:  true,
			kineto:      true,
			intelPT:     true,
			cpuHighRes:  true,
			controlAddr: DefaultControlAddr,
		}
	}
}

func boolFromEnvOr(key string, fallback bool) bool {
	if v, ok := os.LookupEnv(key); ok {
		return parseBool(v)
	}
	return fallback
}

func stringFromEnvOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

// FeatureSummary returns a stable map of resolved optional features for logging.
func (c *Config) FeatureSummary() map[string]any {
	return map[string]any{
		"mode":           c.CollectorMode,
		"ebpf":           c.EBPFEnabled,
		"dcgm":           c.DCGMEnabled,
		"dcgm_prefer":    c.DCGMPrefer,
		"rdc":            c.RDCEnabled,
		"nic":            c.NICEnabled,
		"rdma":           c.RDMAEnabled,
		"pmu":            c.PMUEnabled,
		"tpu":            c.TPUEnabled,
		"kvm":            c.KVMEnabled,
		"interrupts":     c.InterruptsEnabled,
		"kineto":         c.KinetoEnabled,
		"intel_pt":       c.IntelPTEnabled,
		"cpu_highres":    c.CPUHighRes,
		"control_addr":   c.ControlAddr,
		"host_metrics": c.HostMetricsEnabled,
		"interconnect": c.InterconnectEnabled,
	}
}

// LogModeWarnings emits startup warnings for risky combinations.
func (c *Config) LogModeWarnings(logger *slog.Logger) {
	if logger == nil {
		return
	}
	if c.DCGMEnabled && c.DCGMInterval > 0 && c.DCGMInterval.Seconds() < 10 {
		logger.Warn("DCGM interval below 10s may contend with DCP multiplexing",
			"interval_s", c.DCGMInterval.Seconds())
	}
	if c.IntelPTEnabled && c.ControlAddr == "" {
		logger.Warn("Intel PT enabled but OTEL_GPU_CONTROL_ADDR is empty; PT RPC unavailable")
	}
	if c.CPUHighRes && c.ControlAddr == "" {
		logger.Warn("CPU high-res enabled but OTEL_GPU_CONTROL_ADDR is empty; highres RPC unavailable")
	}
	if c.KinetoEnabled && c.ControlAddr == "" {
		logger.Warn("Kineto enabled but OTEL_GPU_CONTROL_ADDR is empty; profile RPC unavailable")
	}
}
