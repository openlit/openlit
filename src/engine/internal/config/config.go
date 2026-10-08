package config

import (
	"os"
	"strings"
	"time"
)

type Config struct {
	NATSURL       string
	NATSUser      string
	NATSPassword  string
	NATSToken     string
	NATSCreds     string
	Stream        string
	OpenLITURL    string
	CronSecret    string
	HTTPAddr      string
	RulesInterval time.Duration
	TickInterval  time.Duration
	Replay        time.Duration
}

func Load() Config {
	secret := os.Getenv("CRON_JOB_SECRET")
	if secret == "" {
		// Matches isValidCronJobRequest when CRON_JOB_SECRET is unset (local dev).
		secret = "true"
	}
	return Config{
		NATSURL:       env("NATS_URL", "nats://127.0.0.1:4222"),
		NATSUser:      strings.TrimSpace(os.Getenv("NATS_USER")),
		NATSPassword:  os.Getenv("NATS_PASSWORD"),
		NATSToken:     os.Getenv("NATS_TOKEN"),
		NATSCreds:     strings.TrimSpace(os.Getenv("NATS_CREDS")),
		Stream:        env("OPENLIT_SIGNALS_STREAM", "OPENLIT_SIGNALS"),
		OpenLITURL:    env("OPENLIT_URL", "http://127.0.0.1:3000"),
		CronSecret:    secret,
		HTTPAddr:      env("ENGINE_HTTP_ADDR", "127.0.0.1:4320"),
		RulesInterval: duration("ENGINE_RULES_REFRESH", 60*time.Second),
		TickInterval:  duration("ENGINE_TICK", 5*time.Second),
		Replay:        duration("ENGINE_REPLAY", 10*time.Minute),
	}
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
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
