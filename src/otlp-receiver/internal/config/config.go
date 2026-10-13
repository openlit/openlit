package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr          string
	GRPCAddr          string
	SQLitePath        string
	RequireAPIKey     bool
	InitDB            ClickHouseConfig
	TenantCacheTTLSec int
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
