package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ApplicationName    string
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
		ApplicationName:    envOrDefault("GPU_APPLICATION_NAME", "default"),
		Environment:        envOrDefault("GPU_ENVIRONMENT", "default"),
		OTLPEndpoint:       envOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		OTLPProtocol:       envOrDefault("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc"),
		CollectionInterval: parseDuration(envOrDefault("GPU_COLLECTION_INTERVAL", "10s"), 10*time.Second),
		EBPFEnabled:        parseBool(envOrDefault("OTEL_GPU_EBPF_ENABLED", "false")),
	}

	cfg.ServiceName = envOrDefault("OTEL_SERVICE_NAME", cfg.ApplicationName)
	cfg.OTLPHeaders = parseHeaders(os.Getenv("OTEL_EXPORTER_OTLP_HEADERS"))

	return cfg
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseDuration(s string, fallback time.Duration) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil {
		return fallback
	}
	return d
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
