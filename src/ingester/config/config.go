package config

import (
	"fmt"
	"os"
	"strconv"

	"github.com/rs/zerolog/log"
	"gopkg.in/yaml.v2"
)

type Configuration struct {
	IngesterPort  string `yaml:"ingesterPort"`
	RentionPeriod string `yaml:"retentionPeriod"`
	PricingInfo   struct {
		LocalFile struct {
			Path string `yaml:"path"`
		} `yaml:"localFile"`
		URL string `yaml:"url"`
	} `yaml:"pricingInfo"`
	DBConfig struct {
		DBName       string `yaml:"name"`
		DBUser       string `yaml:"username"`
		DBPassword   string `yaml:"password"`
		DBHost       string `yaml:"host"`
		DBPort       string `yaml:"port"`
		DBSSLMode    string `yaml:"sslMode"`
		MaxOpenConns int    `yaml:"maxOpenConns"`
		MaxIdleConns int    `yaml:"maxIdleConns"`
	} `yaml:"dbConfig"`
	Connections struct {
		Enabled      bool `yaml:"enabled"`
		GrafanaCloud struct {
			PromURL      string `yaml:"promUrl"`
			PromUsername string `yaml:"promUsername"`
			LokiURL      string `yaml:"lokiUrl"`
			LokiUsername string `yaml:"lokiUsername"`
			AccessToken  string `yaml:"accessToken"`
		} `yaml:"grafanaCloud"`
		NewRelic struct {
			Key        string `yaml:"key"`
			MetricsURL string `yaml:"metricsUrl"`
			LogsURL    string `yaml:"logsUrl"`
		} `yaml:"newRelic"`
		DataDog struct {
			MetricsURL string `yaml:"metricsUrl"`
			LogsURL    string `yaml:"logsUrl"`
			APIKey     string `yaml:"apiKey"`
		} `yaml:"datadog"`
		Signoz struct {
			URL        string `yaml:"url"`
			APIKey     string `yaml:"apiKey"`
		} `yaml:"signoz"`
	} `yaml:"connections"`
}

func validateConfig(cfg *Configuration) error {
	if _, err := strconv.Atoi(cfg.IngesterPort); err != nil {
		return fmt.Errorf("Ingester Port is not defined")
	}
	if _, err := strconv.Atoi(cfg.RentionPeriod); err != nil {
		cfg.RentionPeriod = "6 months"
	}

	// Check if at least one PricingInfo configuration is set.
	if cfg.PricingInfo.LocalFile.Path == "" && cfg.PricingInfo.URL == "" {
		return fmt.Errorf("PricingInfo configuration is not defined")
	}

	// Check if both PricingInfo configurations are set.
	if cfg.PricingInfo.LocalFile.Path != "" && cfg.PricingInfo.URL != "" {
		return fmt.Errorf("Both LocalFile and URL configurations are defined in PricingInfo; only one is allowed")
	}

	if cfg.DBConfig.DBPassword == "" {
		log.Info().Msg("'dbConfig.password' is not defined, trying to read from environment variable 'DB_PASSWORD'")
		cfg.DBConfig.DBPassword = os.Getenv("DB_PASSWORD")
		if cfg.DBConfig.DBPassword == "" {
			return fmt.Errorf("'DB_PASSWORD' environment variable is not set and 'dbConfig.password' is not defined in configuration")
		}
		log.Info().Msg("dbConfig.password is now set")
	}

	if cfg.DBConfig.DBUser == "" {
		log.Info().Msg("'dbConfig.username' is not defined, trying to read from environment variable 'DB_USERNAME")
		cfg.DBConfig.DBUser = os.Getenv("DB_USERNAME")
		if cfg.DBConfig.DBUser == "" {
			return fmt.Errorf("'DB_USERNAME' environment variable is not set and 'dbConfig.username' is not defined in configuration")
		}
		log.Info().Msg("dbConfig.username is now set")
	}

	if cfg.Connections.Enabled {
		definedConfigs := 0

		if cfg.Connections.GrafanaCloud.PromURL != "" {
			definedConfigs++
		}
		if cfg.Connections.NewRelic.Key != "" {
			definedConfigs++
		}
		if cfg.Connections.DataDog.APIKey != "" {
			definedConfigs++
		}
		if cfg.Connections.Signoz.APIKey != "" {
			definedConfigs++
		}

		if definedConfigs > 1 {
			return fmt.Errorf("Only one observability platform configuration (GrafanaCloud, NewRelic, or DataDog) can be enabled at a time")
		}

		if definedConfigs == 0 {
			return fmt.Errorf("Observability platform is enabled, but no observability configurations are defined")
		}
	}

	return nil
}

func LoadConfiguration(configPath string) (*Configuration, error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var cfg Configuration
	err = yaml.Unmarshal(data, &cfg)
	if err != nil {
		return nil, err
	}

	// Validate the loaded configuration
	if err := validateConfig(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
