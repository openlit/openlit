package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Environment        string
	OTLPEndpoint       string
	OTLPHeaders        map[string]string
	OTLPProtocol       string // "grpc" or "http/protobuf"
	ServiceName        string
	CollectionInterval time.Duration
	EBPFEnabled        bool
}

func Load() *Config {
	cfg := &Config{
		ServiceName:  envOrDefault("OTEL_SERVICE_NAME", "default"),
		OTLPEndpoint: envOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		OTLPProtocol: envOrDefault("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc"),
		// OTEL_METRIC_EXPORT_INTERVAL is in milliseconds per the OTel spec.
		CollectionInterval: parseIntervalMS(os.Getenv("OTEL_METRIC_EXPORT_INTERVAL"), 60*time.Second),
		EBPFEnabled:        parseBool(envOrDefault("OTEL_GPU_EBPF_ENABLED", "false")),
	}

	cfg.OTLPHeaders = parseHeaders(os.Getenv("OTEL_EXPORTER_OTLP_HEADERS"))
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

func parseBool(s string) bool {
	b, _ := strconv.ParseBool(s)
	return b
}

// parseHeaders parses "key1=val1,key2=val2" format used by OTEL_EXPORTER_OTLP_HEADERS.
func parseHeaders(raw string) map[string]string {
	headers := make(map[string]string)
	if raw == "" {
		return headers
	}
	for _, pair := range strings.Split(raw, ",") {
		kv := strings.SplitN(pair, "=", 2)
		if len(kv) == 2 {
			headers[strings.TrimSpace(kv[0])] = strings.TrimSpace(kv[1])
		}
	}
	return headers
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
