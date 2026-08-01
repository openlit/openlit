package config

import (
	"os"
	"runtime"
	"slices"
	"testing"
	"time"
)

func TestParseIntervalMS(t *testing.T) {
	tests := []struct {
		input    string
		fallback time.Duration
		want     time.Duration
	}{
		{"5000", 10 * time.Second, 5 * time.Second},
		{"1000", 10 * time.Second, 1 * time.Second},
		{"", 10 * time.Second, 10 * time.Second},
		{"0", 10 * time.Second, 10 * time.Second},
		{"-100", 10 * time.Second, 10 * time.Second},
		{"notanumber", 10 * time.Second, 10 * time.Second},
	}

	for _, tt := range tests {
		got := parseIntervalMS(tt.input, tt.fallback)
		if got != tt.want {
			t.Errorf("parseIntervalMS(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestParseResourceAttr(t *testing.T) {
	tests := []struct {
		raw      string
		key      string
		fallback string
		want     string
	}{
		{"", "deployment.environment", "default", "default"},
		{"deployment.environment=production", "deployment.environment", "default", "production"},
		{"team=ml,deployment.environment=staging", "deployment.environment", "default", "staging"},
		{"deployment.environment=prod,team=ml", "deployment.environment", "default", "prod"},
		{"other=value", "deployment.environment", "default", "default"},
		{" deployment.environment = canary ", "deployment.environment", "default", "canary"},
	}

	for _, tt := range tests {
		got := parseResourceAttr(tt.raw, tt.key, tt.fallback)
		if got != tt.want {
			t.Errorf("parseResourceAttr(%q, %q) = %q, want %q", tt.raw, tt.key, got, tt.want)
		}
	}
}

func TestParseList(t *testing.T) {
	tests := []struct {
		input string
		want  []string
	}{
		{"ext4,xfs", []string{"ext4", "xfs"}},
		{" ext4 , xfs ,", []string{"ext4", "xfs"}},
		{"squashfs", []string{"squashfs"}},
		{"", nil},
	}

	for _, tt := range tests {
		if got := parseList(tt.input); !slices.Equal(got, tt.want) {
			t.Errorf("parseList(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestLoadDefaults(t *testing.T) {
	// Ensure no env vars interfere. Default mode is all.
	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "")
	t.Setenv("OTEL_GPU_EBPF_ENABLED", "")
	t.Setenv("OTEL_SERVICE_NAME", "")
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "")
	t.Setenv("OTEL_GPU_COLLECTOR_MODE", "")
	os.Unsetenv("OTEL_GPU_COLLECTOR_MODE")
	os.Unsetenv("OTEL_GPU_EBPF_ENABLED")
	// The exclude default applies only when the variable is UNSET; t.Setenv
	// registers the restore, os.Unsetenv makes it unset for this test.
	t.Setenv("OTEL_GPU_FS_TYPES_EXCLUDE", "")
	os.Unsetenv("OTEL_GPU_FS_TYPES_EXCLUDE")

	cfg := Load()

	if cfg.ServiceName != "" {
		t.Errorf("ServiceName = %q, want empty when OTEL_SERVICE_NAME unset", cfg.ServiceName)
	}
	if cfg.CollectionInterval != 60*time.Second {
		t.Errorf("CollectionInterval = %v, want %v", cfg.CollectionInterval, 60*time.Second)
	}
	if cfg.CollectorMode != ModeAll {
		t.Errorf("CollectorMode = %q, want all", cfg.CollectorMode)
	}
	wantEBPF := runtime.GOOS == "linux"
	if cfg.EBPFEnabled != wantEBPF {
		t.Errorf("EBPFEnabled = %v, want %v (default for %s)", cfg.EBPFEnabled, wantEBPF, runtime.GOOS)
	}
	if cfg.Environment != "default" {
		t.Errorf("Environment = %q, want %q", cfg.Environment, "default")
	}
	if want := []string{"squashfs", "erofs", "iso9660", "cramfs", "romfs", "cd9660", "CDFS", "UDF"}; !slices.Equal(cfg.FSTypesExclude, want) {
		t.Errorf("FSTypesExclude = %v, want %v", cfg.FSTypesExclude, want)
	}
}

func TestLoadFSTypesExcludeSetButEmpty(t *testing.T) {
	// Explicitly set to empty means "exclude nothing", not "use the default".
	t.Setenv("OTEL_GPU_FS_TYPES_EXCLUDE", "")

	cfg := Load()

	if len(cfg.FSTypesExclude) != 0 {
		t.Errorf("FSTypesExclude = %v, want empty", cfg.FSTypesExclude)
	}
}

func TestLoadFromEnv(t *testing.T) {
	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "5000")
	t.Setenv("OTEL_GPU_EBPF_ENABLED", "true")
	t.Setenv("OTEL_SERVICE_NAME", "gpu-collector")
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment=production,team=ml")
	t.Setenv("OTEL_GPU_FS_TYPES_EXCLUDE", "squashfs,erofs")

	cfg := Load()

	if cfg.CollectionInterval != 5*time.Second {
		t.Errorf("CollectionInterval = %v, want %v", cfg.CollectionInterval, 5*time.Second)
	}
	if !cfg.EBPFEnabled {
		t.Error("EBPFEnabled should be true")
	}
	if cfg.ServiceName != "gpu-collector" {
		t.Errorf("ServiceName = %q, want %q", cfg.ServiceName, "gpu-collector")
	}
	if cfg.Environment != "production" {
		t.Errorf("Environment = %q, want %q", cfg.Environment, "production")
	}
	if want := []string{"squashfs", "erofs"}; !slices.Equal(cfg.FSTypesExclude, want) {
		t.Errorf("FSTypesExclude = %v, want %v", cfg.FSTypesExclude, want)
	}
}

func TestLoadEBPFDisabled(t *testing.T) {
	t.Setenv("OTEL_GPU_EBPF_ENABLED", "false")

	cfg := Load()
	if cfg.EBPFEnabled {
		t.Error("EBPFEnabled should be false when OTEL_GPU_EBPF_ENABLED=false")
	}
}

func TestLoadOptionalFeatureFlags(t *testing.T) {
	t.Setenv("OTEL_GPU_DCGM_ENABLED", "true")
	t.Setenv("OTEL_GPU_DCGM_INTERVAL", "15")
	t.Setenv("OTEL_GPU_KINETO_ENABLED", "true")
	t.Setenv("OTEL_HOST_NIC_ENABLED", "true")
	t.Setenv("OTEL_HOST_RDMA_ENABLED", "true")
	t.Setenv("OTEL_HOST_PMU_ENABLED", "true")
	t.Setenv("OTEL_TPU_ENABLED", "true")
	t.Setenv("OTEL_HOST_KVM_ENABLED", "true")
	t.Setenv("OTEL_HOST_INTERRUPTS_ENABLED", "true")
	t.Setenv("OTEL_GPU_RDC_ENABLED", "true")
	t.Setenv("OTEL_GPU_PROMETHEUS_ADDR", "127.0.0.1:9464")
	t.Setenv("OTEL_GPU_CONTROL_ADDR", "127.0.0.1:1778")
	t.Setenv("OTEL_HOST_CPU_HIGHRES", "true")

	cfg := Load()

	if !cfg.DCGMEnabled || cfg.DCGMInterval != 15*time.Second {
		t.Errorf("DCGM: enabled=%v interval=%v", cfg.DCGMEnabled, cfg.DCGMInterval)
	}
	if !cfg.KinetoEnabled || !cfg.NICEnabled || !cfg.RDMAEnabled || !cfg.PMUEnabled {
		t.Error("expected Kineto/NIC/RDMA/PMU enabled")
	}
	if !cfg.TPUEnabled || !cfg.KVMEnabled || !cfg.InterruptsEnabled || !cfg.RDCEnabled {
		t.Error("expected TPU/KVM/Interrupts/RDC enabled")
	}
	if cfg.PrometheusAddr != "127.0.0.1:9464" || cfg.ControlAddr != "127.0.0.1:1778" {
		t.Errorf("addrs: prom=%q control=%q", cfg.PrometheusAddr, cfg.ControlAddr)
	}
	if !cfg.CPUHighRes {
		t.Error("CPUHighRes should be true")
	}
}

func TestLoadDefaultsParityFlagsOff(t *testing.T) {
	// light mode restores the historical "optional features off" footprint.
	for _, k := range []string{
		"OTEL_GPU_COLLECTOR_MODE",
		"OTEL_GPU_DCGM_ENABLED", "OTEL_GPU_KINETO_ENABLED", "OTEL_HOST_NIC_ENABLED",
		"OTEL_HOST_RDMA_ENABLED", "OTEL_HOST_PMU_ENABLED", "OTEL_TPU_ENABLED",
		"OTEL_HOST_KVM_ENABLED", "OTEL_HOST_INTERRUPTS_ENABLED", "OTEL_GPU_RDC_ENABLED",
		"OTEL_GPU_PROMETHEUS_ADDR", "OTEL_GPU_CONTROL_ADDR", "OTEL_HOST_CPU_HIGHRES",
		"OTEL_HOST_INTEL_PT_ENABLED",
	} {
		t.Setenv(k, "")
		os.Unsetenv(k)
	}
	t.Setenv("OTEL_GPU_COLLECTOR_MODE", ModeLight)

	cfg := Load()
	if cfg.DCGMEnabled || cfg.KinetoEnabled || cfg.NICEnabled || cfg.PMUEnabled || cfg.TPUEnabled {
		t.Error("optional features should be off in light mode")
	}
}
