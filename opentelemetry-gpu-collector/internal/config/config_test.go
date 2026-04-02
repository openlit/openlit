package config

import (
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

func TestParseHeaders(t *testing.T) {
	tests := []struct {
		input string
		want  map[string]string
	}{
		{"", map[string]string{}},
		{"Authorization=Bearer token", map[string]string{"Authorization": "Bearer token"}},
		{"k1=v1,k2=v2", map[string]string{"k1": "v1", "k2": "v2"}},
		{"key=val=with=equals", map[string]string{"key": "val=with=equals"}},
		{" k = v ", map[string]string{"k": "v"}},
	}

	for _, tt := range tests {
		got := parseHeaders(tt.input)
		if len(got) != len(tt.want) {
			t.Errorf("parseHeaders(%q) returned %d entries, want %d", tt.input, len(got), len(tt.want))
			continue
		}
		for k, v := range tt.want {
			if got[k] != v {
				t.Errorf("parseHeaders(%q)[%q] = %q, want %q", tt.input, k, got[k], v)
			}
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

func TestLoadDefaults(t *testing.T) {
	// Ensure no env vars interfere.
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	t.Setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "")
	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "")
	t.Setenv("OTEL_GPU_EBPF_ENABLED", "")
	t.Setenv("OTEL_SERVICE_NAME", "")
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "")

	cfg := Load()

	if cfg.ServiceName != "default" {
		t.Errorf("ServiceName = %q, want %q", cfg.ServiceName, "default")
	}
	if cfg.OTLPProtocol != "grpc" {
		t.Errorf("OTLPProtocol = %q, want %q", cfg.OTLPProtocol, "grpc")
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
}

func TestLoadFromEnv(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
	t.Setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "5000")
	t.Setenv("OTEL_GPU_EBPF_ENABLED", "true")
	t.Setenv("OTEL_SERVICE_NAME", "gpu-collector")
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment=production,team=ml")

	cfg := Load()

	if cfg.OTLPEndpoint != "http://localhost:4317" {
		t.Errorf("OTLPEndpoint = %q, want %q", cfg.OTLPEndpoint, "http://localhost:4317")
	}
	if cfg.OTLPProtocol != "http/protobuf" {
		t.Errorf("OTLPProtocol = %q, want %q", cfg.OTLPProtocol, "http/protobuf")
	}
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
}
