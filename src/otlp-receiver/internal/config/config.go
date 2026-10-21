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
	TenantCacheMax    int
	// AuthFailBurst/AuthFailPerMin bound rejected API keys per client IP.
	AuthFailBurst  int
	AuthFailPerMin int
	// StatsAddr serves pipeline counters on a separate, local-only listener.
	StatsAddr string
	NATS      NATSConfig
}

// NATSConfig enables realtime fan-out when URL is set. The receiver only
// needs publish rights on openlit.signal.> (plus stream create/update/info
// when EnsureStream is on) and subscribe rights on its own inbox.
type NATSConfig struct {
	URL          string
	User         string
	Password     string
	Token        string
	CredsFile    string
	TLSCAFile    string
	TLSCertFile  string
	TLSKeyFile   string
	TLSRequired  bool
	Stream       string
	MaxAge       time.Duration
	MaxBytes     int64
	MaxMsgs      int64
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
		TenantCacheMax:    intEnv("OTLP_TENANT_CACHE_MAX", 10000),
		AuthFailBurst:     intEnv("OTLP_AUTH_FAIL_BURST", 20),
		AuthFailPerMin:    intEnv("OTLP_AUTH_FAIL_PER_MIN", 60),
		StatsAddr:         env("OTLP_STATS_ADDR", "127.0.0.1:4319"),
		NATS: NATSConfig{
			URL: strings.TrimSpace(os.Getenv("NATS_URL")),
			// NATS_RECEIVER_* lets the receiver and engine use separate NATS
			// users with separate permissions; NATS_* is a shared fallback.
			User:         firstEnv("NATS_RECEIVER_USER", "NATS_USER"),
			Password:     firstRawEnv("NATS_RECEIVER_PASSWORD", "NATS_PASSWORD"),
			Token:        firstRawEnv("NATS_RECEIVER_TOKEN", "NATS_TOKEN"),
			CredsFile:    firstEnv("NATS_RECEIVER_CREDS", "NATS_CREDS"),
			TLSCAFile:    strings.TrimSpace(os.Getenv("NATS_TLS_CA")),
			TLSCertFile:  strings.TrimSpace(os.Getenv("NATS_TLS_CERT")),
			TLSKeyFile:   strings.TrimSpace(os.Getenv("NATS_TLS_KEY")),
			TLSRequired:  boolEnv("NATS_TLS_REQUIRED", false),
			Stream:       env("OPENLIT_SIGNALS_STREAM", "OPENLIT_SIGNALS"),
			MaxAge:       durationEnv("OPENLIT_SIGNALS_MAX_AGE", 10*time.Minute),
			MaxBytes:     int64Env("OPENLIT_SIGNAL_STREAM_MAX_BYTES", 256<<20),
			MaxMsgs:      int64Env("OPENLIT_SIGNAL_STREAM_MAX_MSGS", 0),
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

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
	}
	return ""
}

func firstRawEnv(keys ...string) string {
	for _, key := range keys {
		if v := os.Getenv(key); v != "" {
			return v
		}
	}
	return ""
}

func int64Env(key string, fallback int64) int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < 0 {
		return fallback
	}
	return n
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
