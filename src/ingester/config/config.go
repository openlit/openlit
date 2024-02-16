package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Assuming Configuration struct definition is globally accessible
type Configuration struct {
	IngesterPort string `json:"ingesterPort"`
	Pricing      struct {
		URL string `json:"url"`
	} `json:"pricing"`
	Database struct {
		Host         string `json:"host"`
		Name         string `json:"name"`
		Password     string `json:"password"`
		Port         string `json:"port"`
		SSLMode      string `json:"sslmode"`
		User         string `json:"user"`
		MaxIdleConns int    `json:"maxIdleConns"`
		MaxOpenConns int    `json:"maxOpenConns"`
	} `json:"database"`
}

func getIntFromEnv(envKey string) int {
	valueStr := os.Getenv(envKey)
	if value, err := strconv.Atoi(valueStr); err == nil {
		return value
	}
	return 0
}

func LoadConfigFromEnv() (*Configuration, error) {
	// Creating the configuration instance
	config := &Configuration{}

	// Loading configuration from environment variables
	config.Database.Host = os.Getenv("DOKU_DB_HOST")
	config.Database.Name = os.Getenv("DOKU_DB_NAME")
	config.Database.Password = os.Getenv("DOKU_DB_PASSWORD")
	config.Database.Port = os.Getenv("DOKU_DB_PORT")
	config.Database.SSLMode = os.Getenv("DOKU_DB_SSLMODE")
	config.Database.User = os.Getenv("DOKU_DB_USER")
	config.Database.MaxIdleConns = getIntFromEnv("DOKU_DB_MAX_IDLE_CONNS")
	config.Database.MaxOpenConns = getIntFromEnv("DOKU_DB_MAX_OPEN_CONNS")
	config.IngesterPort = os.Getenv("DOKU_INGESTER_PORT")
	config.Pricing.URL = os.Getenv("DOKU_PRICING_URL")

	// Setting default values if the environment variables are not provided
	if config.IngesterPort == "" {
		config.IngesterPort = "9044" // default port
	}
	if config.Pricing.URL == "" {
		config.Pricing.URL = "https://raw.githubusercontent.com/dokulabs/doku/main/assets/pricing.json" // default pricing URL
	}
	if config.Database.MaxIdleConns == 0 {
		config.Database.MaxIdleConns = 10 // default max idle connections
	}
	if config.Database.MaxOpenConns == 0 {
		config.Database.MaxOpenConns = 20 // default max open connections
	}

	missingVars := []string{}

	// Checking required environment variables and collecting names of missing ones
	if config.Database.Host == "" {
		missingVars = append(missingVars, "DOKU_DB_HOST")
	}
	if config.Database.Password == "" {
		missingVars = append(missingVars, "DOKU_DB_PASSWORD")
	}
	if config.Database.Port == "" {
		missingVars = append(missingVars, "DOKU_DB_PORT")
	}
	if config.Database.SSLMode == "" {
		missingVars = append(missingVars, "DOKU_DB_SSLMODE")
	}
	if config.Database.User == "" {
		missingVars = append(missingVars, "DOKU_DB_USER")
	}
	if config.Database.Name == "" {
		missingVars = append(missingVars, "DOKU_DB_NAME")
	}

	// Returning an error listing all missing variables, if any
	if len(missingVars) > 0 {
		return nil, fmt.Errorf("missing required environment variables: %s", strings.Join(missingVars, ", "))
	}

	return config, nil
}
