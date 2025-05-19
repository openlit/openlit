package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Config represents the collector configuration
type Config struct {
	GPU         GPUConfig         `yaml:"gpu"`
	Collection  CollectionConfig  `yaml:"collection"`
	Export      ExportConfig      `yaml:"export"`
	Kubernetes  KubernetesConfig  `yaml:"kubernetes"`
	Logging     LoggingConfig     `yaml:"logging"`
	Error       ErrorConfig       `yaml:"error"`
	HealthCheck HealthCheckConfig `yaml:"health_check"`
}

// GPUConfig represents GPU-specific configuration
type GPUConfig struct {
	Enabled         bool     `yaml:"enabled"`
	Types           []string `yaml:"types"`
	MaxGPUs         int      `yaml:"max_gpus"`
	EnableProfiling bool     `yaml:"enable_profiling"`
	Events          EventsConfig `yaml:"events"`
}

// EventsConfig represents GPU event monitoring configuration
type EventsConfig struct {
	Enabled     bool     `yaml:"enabled"`
	Types       []string `yaml:"types"`
	BufferSize  int      `yaml:"buffer_size"`
	SampleRate  float64  `yaml:"sample_rate"`
	ProcessInfo bool     `yaml:"process_info"`
}

// CollectionConfig represents metric collection configuration
type CollectionConfig struct {
	Interval      time.Duration `yaml:"interval"`
	BatchSize     int           `yaml:"batch_size"`
	MaxRetries    int           `yaml:"max_retries"`
	RetryDelay    time.Duration `yaml:"retry_delay"`
	Timeout       time.Duration `yaml:"timeout"`
	RateLimit     int           `yaml:"rate_limit"`
	CacheDuration time.Duration `yaml:"cache_duration"`
}

// ExportConfig represents OpenTelemetry export configuration
type ExportConfig struct {
	Endpoint     string            `yaml:"endpoint"`
	Headers      map[string]string `yaml:"headers"`
	Timeout      time.Duration     `yaml:"timeout"`
	BatchSize    int               `yaml:"batch_size"`
	MaxQueueSize int               `yaml:"max_queue_size"`
	RetryOnError bool              `yaml:"retry_on_error"`
}

// KubernetesConfig represents Kubernetes integration configuration
type KubernetesConfig struct {
	Enabled    bool   `yaml:"enabled"`
	Kubeconfig string `yaml:"kubeconfig"`
	InCluster  bool   `yaml:"in_cluster"`
	NodeName   string `yaml:"node_name"`
}

// LoggingConfig represents logging configuration
type LoggingConfig struct {
	Level      string `yaml:"level"`
	Format     string `yaml:"format"`
	OutputPath string `yaml:"output_path"`
}

// ErrorConfig represents error handling configuration
type ErrorConfig struct {
	ReportingEnabled bool          `yaml:"reporting_enabled"`
	RetryCount      int           `yaml:"retry_count"`
	RetryDelay      time.Duration `yaml:"retry_delay"`
}

// HealthCheckConfig represents health check configuration
type HealthCheckConfig struct {
	Enabled     bool          `yaml:"enabled"`
	Port        int           `yaml:"port"`
	Path        string        `yaml:"path"`
	Interval    time.Duration `yaml:"interval"`
	Timeout     time.Duration `yaml:"timeout"`
	MaxFailures int           `yaml:"max_failures"`
}

// LoadConfig loads configuration from environment variables and defaults
func LoadConfig() (*Config, error) {
	config := &Config{
		GPU: GPUConfig{
			Enabled:         getEnvOrDefaultBool("GPU_ENABLED", true),
			Types:           getEnvOrDefaultStringSlice("GPU_TYPES", []string{"nvidia", "amd"}),
			MaxGPUs:         getEnvOrDefaultInt("GPU_MAX_GPUS", 8),
			EnableProfiling: getEnvOrDefaultBool("GPU_ENABLE_PROFILING", false),
			Events: EventsConfig{
				Enabled:     getEnvOrDefaultBool("GPU_EVENTS_ENABLED", true),
				Types:       getEnvOrDefaultStringSlice("GPU_EVENTS_TYPES", []string{"utilization", "memory", "power", "temperature"}),
				BufferSize:  getEnvOrDefaultInt("GPU_EVENTS_BUFFER_SIZE", 1000),
				SampleRate:  getEnvOrDefaultFloat64("GPU_EVENTS_SAMPLE_RATE", 1.0),
				ProcessInfo: getEnvOrDefaultBool("GPU_EVENTS_PROCESS_INFO", true),
			},
		},
		Collection: CollectionConfig{
			Interval:      getEnvOrDefaultDuration("COLLECTION_INTERVAL", 15*time.Second),
			BatchSize:     getEnvOrDefaultInt("COLLECTION_BATCH_SIZE", 10),
			MaxRetries:    getEnvOrDefaultInt("COLLECTION_MAX_RETRIES", 3),
			RetryDelay:    getEnvOrDefaultDuration("COLLECTION_RETRY_DELAY", 5*time.Second),
			Timeout:       getEnvOrDefaultDuration("COLLECTION_TIMEOUT", 30*time.Second),
			RateLimit:     getEnvOrDefaultInt("COLLECTION_RATE_LIMIT", 100),
			CacheDuration: getEnvOrDefaultDuration("COLLECTION_CACHE_DURATION", 5*time.Second),
		},
		Export: ExportConfig{
			Endpoint:     getEnvOrDefaultString("OTEL_EXPORTER_OTLP_ENDPOINT", "localhost:4317"),
			Headers:      getEnvOrDefaultStringMap("OTEL_EXPORTER_OTLP_HEADERS", map[string]string{}),
			Timeout:      getEnvOrDefaultDuration("OTEL_EXPORTER_OTLP_TIMEOUT", 30*time.Second),
			BatchSize:    getEnvOrDefaultInt("OTEL_EXPORTER_OTLP_BATCH_SIZE", 512),
			MaxQueueSize: getEnvOrDefaultInt("OTEL_EXPORTER_OTLP_MAX_QUEUE_SIZE", 2048),
			RetryOnError: getEnvOrDefaultBool("OTEL_EXPORTER_OTLP_RETRY_ON_ERROR", true),
		},
		Kubernetes: KubernetesConfig{
			Enabled:    getEnvOrDefaultBool("KUBERNETES_ENABLED", false),
			Kubeconfig: getEnvOrDefaultString("KUBECONFIG", ""),
			InCluster:  getEnvOrDefaultBool("KUBERNETES_IN_CLUSTER", false),
			NodeName:   getEnvOrDefaultString("KUBERNETES_NODE_NAME", ""),
		},
		Logging: LoggingConfig{
			Level:      getEnvOrDefaultString("LOG_LEVEL", "info"),
			Format:     getEnvOrDefaultString("LOG_FORMAT", "json"),
			OutputPath: getEnvOrDefaultString("LOG_OUTPUT_PATH", ""),
		},
		Error: ErrorConfig{
			ReportingEnabled: getEnvOrDefaultBool("ERROR_REPORTING_ENABLED", true),
			RetryCount:      getEnvOrDefaultInt("ERROR_RETRY_COUNT", 3),
			RetryDelay:      getEnvOrDefaultDuration("ERROR_RETRY_DELAY", 5*time.Second),
		},
		HealthCheck: HealthCheckConfig{
			Enabled:     getEnvOrDefaultBool("HEALTH_CHECK_ENABLED", true),
			Port:        getEnvOrDefaultInt("HEALTH_CHECK_PORT", 8080),
			Path:        getEnvOrDefaultString("HEALTH_CHECK_PATH", "/health"),
			Interval:    getEnvOrDefaultDuration("HEALTH_CHECK_INTERVAL", 30*time.Second),
			Timeout:     getEnvOrDefaultDuration("HEALTH_CHECK_TIMEOUT", 5*time.Second),
			MaxFailures: getEnvOrDefaultInt("HEALTH_CHECK_MAX_FAILURES", 3),
		},
	}

	return config, nil
}

// Helper functions for environment variable handling
func getEnvOrDefaultString(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvOrDefaultInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getEnvOrDefaultFloat64(key string, defaultValue float64) float64 {
	if value := os.Getenv(key); value != "" {
		if floatValue, err := strconv.ParseFloat(value, 64); err == nil {
			return floatValue
		}
	}
	return defaultValue
}

func getEnvOrDefaultBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}

func getEnvOrDefaultDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if duration, err := time.ParseDuration(value); err == nil {
			return duration
		}
	}
	return defaultValue
}

func getEnvOrDefaultStringSlice(key string, defaultValue []string) []string {
	if value := os.Getenv(key); value != "" {
		return strings.Split(value, ",")
	}
	return defaultValue
}

func getEnvOrDefaultStringMap(key string, defaultValue map[string]string) map[string]string {
	if value := os.Getenv(key); value != "" {
		result := make(map[string]string)
		pairs := strings.Split(value, ",")
		for _, pair := range pairs {
			kv := strings.SplitN(pair, "=", 2)
			if len(kv) == 2 {
				result[kv[0]] = kv[1]
			}
		}
		return result
	}
	return defaultValue
} 