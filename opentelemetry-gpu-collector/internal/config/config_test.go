package config

import (
	"os"
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
	// Ensure no env vars interfere.
	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "")
	t.Setenv("OTEL_GPU_EBPF_ENABLED", "")
	t.Setenv("OTEL_SERVICE_NAME", "")
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "")
	// The exclude default applies only when the variable is UNSET; t.Setenv
	// registers the restore, os.Unsetenv makes it unset for this test.
	t.Setenv("OTEL_GPU_FS_TYPES_EXCLUDE", "")
	os.Unsetenv("OTEL_GPU_FS_TYPES_EXCLUDE")

	cfg := Load()

	if cfg.ServiceName != "default" {
		t.Errorf("ServiceName = %q, want %q", cfg.ServiceName, "default")
	}
	if cfg.CollectionInterval != 60*time.Second {
		t.Errorf("CollectionInterval = %v, want %v", cfg.CollectionInterval, 60*time.Second)
	}
	if cfg.EBPFEnabled {
		t.Error("EBPFEnabled should be false by default")
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
