package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr          string
	GRPCAddr          string
	SQLitePath        string
	RequireAPIKey     bool
	InitDB            ClickHouseConfig
	TenantCacheTTLSec int
	NATS              NATSConfig
}

// NATSConfig enables realtime fan-out when URL is set. The receiver only
// needs publish rights on openlit.signal.> (plus stream create/info when
// EnsureStream is on).
type NATSConfig struct {
	URL          string
	User         string
	Password     string
	Token        string
	CredsFile    string
	Stream       string
	MaxAge       time.Duration
	Buffer       int
	EnsureStream bool
}

type ClickHouseConfig struct {
	Host     string
	Port     string
	Username string
	Password string
	Database string
}

func Load() Config {
	return Config{
		HTTPAddr:          env("OTLP_HTTP_ADDR", "0.0.0.0:4318"),
		GRPCAddr:          env("OTLP_GRPC_ADDR", "0.0.0.0:4317"),
		SQLitePath:        sqlitePath(os.Getenv("SQLITE_DATABASE_URL")),
		RequireAPIKey:     boolEnv("OTLP_REQUIRE_API_KEY", false),
		TenantCacheTTLSec: intEnv("OTLP_TENANT_CACHE_TTL_SEC", 30),
		NATS: NATSConfig{
			URL:          strings.TrimSpace(os.Getenv("NATS_URL")),
			User:         strings.TrimSpace(os.Getenv("NATS_USER")),
			Password:     os.Getenv("NATS_PASSWORD"),
			Token:        os.Getenv("NATS_TOKEN"),
			CredsFile:    strings.TrimSpace(os.Getenv("NATS_CREDS")),
			Stream:       env("OPENLIT_SIGNALS_STREAM", "OPENLIT_SIGNALS"),
			MaxAge:       durationEnv("OPENLIT_SIGNALS_MAX_AGE", 10*time.Minute),
			Buffer:       intEnv("NATS_PUBLISH_BUFFER", 10000),
			EnsureStream: boolEnv("NATS_ENSURE_STREAM", true),
		},
		InitDB: ClickHouseConfig{
			Host:     env("INIT_DB_HOST", "127.0.0.1"),
			Port:     env("INIT_DB_PORT", "8123"),
			Username: env("INIT_DB_USERNAME", "default"),
			Password: os.Getenv("INIT_DB_PASSWORD"),
			Database: env("INIT_DB_DATABASE", "openlit"),
		},
	}
}

func sqlitePath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	raw = strings.TrimPrefix(raw, "file:")
	if i := strings.Index(raw, "?"); i >= 0 {
		raw = raw[:i]
	}
	return raw
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func boolEnv(key string, fallback bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	switch strings.ToLower(v) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func intEnv(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}
