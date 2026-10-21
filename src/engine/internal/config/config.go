package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	NATSURL      string
	NATSUser     string
	NATSPassword string
	NATSToken    string
	NATSCreds    string
	NATSTLS      TLSConfig
	Stream       string
	OpenLITURL   string
	// EngineSecret authenticates the engine to the OpenLIT internal API and
	// callers of the engine's own HTTP API. It is never the cron secret.
	EngineSecret  string
	HTTPAddr      string
	RulesInterval time.Duration
	TickInterval  time.Duration
	Replay        time.Duration
	Limits        Limits
}

// TLSConfig enables TLS (and optionally mTLS) to NATS.
type TLSConfig struct {
	CAFile   string
	CertFile string
	KeyFile  string
	Required bool
}

type Limits struct {
	MaxWindows          int
	MaxWindowsPerTenant int
	MaxWindowsPerRule   int
	MaxSamplesPerWindow int
	FindingsPerMinute   int
}

func Load() Config {
	return Config{
		NATSURL: env("NATS_URL", "nats://127.0.0.1:4222"),
		// NATS_ENGINE_* lets the engine and receiver use separate NATS users
		// with separate permissions; NATS_* remains as a shared fallback.
		NATSUser:     firstEnv("NATS_ENGINE_USER", "NATS_USER"),
		NATSPassword: firstRawEnv("NATS_ENGINE_PASSWORD", "NATS_PASSWORD"),
		NATSToken:    firstRawEnv("NATS_ENGINE_TOKEN", "NATS_TOKEN"),
		NATSCreds:    firstEnv("NATS_ENGINE_CREDS", "NATS_CREDS"),
		NATSTLS: TLSConfig{
			CAFile:   strings.TrimSpace(os.Getenv("NATS_TLS_CA")),
			CertFile: strings.TrimSpace(os.Getenv("NATS_TLS_CERT")),
			KeyFile:  strings.TrimSpace(os.Getenv("NATS_TLS_KEY")),
			Required: boolEnv("NATS_TLS_REQUIRED", false),
		},
		Stream:        env("OPENLIT_SIGNALS_STREAM", "OPENLIT_SIGNALS"),
		OpenLITURL:    env("OPENLIT_URL", "http://127.0.0.1:3000"),
		EngineSecret:  strings.TrimSpace(os.Getenv("OPENLIT_ENGINE_SECRET")),
		HTTPAddr:      env("ENGINE_HTTP_ADDR", "127.0.0.1:4330"),
		RulesInterval: duration("ENGINE_RULES_REFRESH", 10*time.Second),
		TickInterval:  duration("ENGINE_TICK", 5*time.Second),
		Replay:        duration("ENGINE_REPLAY", 10*time.Minute),
		Limits: Limits{
			MaxWindows:          intEnv("OPENLIT_ENGINE_MAX_WINDOWS", 50000),
			MaxWindowsPerTenant: intEnv("OPENLIT_ENGINE_MAX_WINDOWS_PER_TENANT", 1000),
			MaxWindowsPerRule:   intEnv("OPENLIT_ENGINE_MAX_WINDOWS_PER_RULE", 200),
			MaxSamplesPerWindow: intEnv("OPENLIT_ENGINE_MAX_SAMPLES_PER_WINDOW", 5000),
			FindingsPerMinute:   intEnv("OPENLIT_ENGINE_FINDINGS_PER_MIN", 60),
		},
	}
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

func intEnv(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func boolEnv(key string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func duration(key string, fallback time.Duration) time.Duration {
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
