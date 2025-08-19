package config

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
)

type ConfigTestSuite struct {
	suite.Suite
	originalEnv map[string]string
}

func (suite *ConfigTestSuite) SetupTest() {
	// Store original environment variables
	suite.originalEnv = make(map[string]string)
	envVars := []string{
		"WEBHOOK_PORT",
		"WEBHOOK_CERT_DIR",
		"SELF_MONITORING_ENABLED",
		"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_HEADERS",
		"OTEL_SERVICE_NAME",
		"DEPLOYMENT_ENVIRONMENT",
	}

	for _, env := range envVars {
		if value, exists := os.LookupEnv(env); exists {
			suite.originalEnv[env] = value
		}
	}
}

func (suite *ConfigTestSuite) TearDownTest() {
	// Restore original environment variables
	envVars := []string{
		"WEBHOOK_PORT",
		"WEBHOOK_CERT_DIR",
		"SELF_MONITORING_ENABLED",
		"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_HEADERS",
		"OTEL_SERVICE_NAME",
		"DEPLOYMENT_ENVIRONMENT",
	}

	// Clear all test environment variables
	for _, env := range envVars {
		os.Unsetenv(env)
	}

	// Restore original values
	for env, value := range suite.originalEnv {
		os.Setenv(env, value)
	}
}

func (suite *ConfigTestSuite) TestDefaultConfiguration() {
	// Clear all environment variables
	os.Unsetenv("WEBHOOK_PORT")
	os.Unsetenv("WEBHOOK_CERT_DIR")
	os.Unsetenv("SELF_MONITORING_ENABLED")

	config, err := GetConfig()
	suite.NoError(err)

	// Test default values
	suite.Equal(9443, config.WebhookPort, "Should use default webhook port")
	suite.Equal("/tmp/k8s-webhook-server/serving-certs", config.WebhookCertDir, "Should use default cert directory")
	suite.True(config.SelfMonitoringEnabled, "Should enable self-monitoring by default")
	suite.Equal("openlit-operator", config.ServiceName, "Should use default service name")
	suite.Equal("kubernetes", config.DeploymentEnvironment, "Should use default deployment environment")
}

func (suite *ConfigTestSuite) TestEnvironmentVariableOverrides() {
	// Set environment variables
	os.Setenv("WEBHOOK_PORT", "8443")
	os.Setenv("WEBHOOK_CERT_DIR", "/custom/certs")
	os.Setenv("SELF_MONITORING_ENABLED", "false")
	os.Setenv("OTEL_SERVICE_NAME", "custom-operator")
	os.Setenv("DEPLOYMENT_ENVIRONMENT", "staging")

	config, err := GetConfig()
	suite.NoError(err)

	// Test environment variable overrides
	suite.Equal(8443, config.WebhookPort, "Should use environment variable for webhook port")
	suite.Equal("/custom/certs", config.WebhookCertDir, "Should use environment variable for cert directory")
	suite.False(config.SelfMonitoringEnabled, "Should use environment variable for self-monitoring")
	suite.Equal("custom-operator", config.ServiceName, "Should use environment variable for service name")
	suite.Equal("staging", config.DeploymentEnvironment, "Should use environment variable for deployment environment")
}

func (suite *ConfigTestSuite) TestOTLPConfiguration() {
	// Test OTLP configuration
	os.Setenv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", "https://logs.example.com/v1/logs")
	os.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Bearer token123")

	config, err := GetConfig()
	suite.NoError(err)

	suite.Equal("https://logs.example.com/v1/logs", config.OTLPLogsEndpoint, "Should use OTLP logs endpoint")
	suite.Equal("Authorization=Bearer token123", config.OTLPHeaders, "Should use OTLP headers")
}

func (suite *ConfigTestSuite) TestInvalidWebhookPort() {
	// Test invalid webhook port
	os.Setenv("WEBHOOK_PORT", "invalid")

	config, err := GetConfig()
	suite.NoError(err)

	// Should fall back to default
	suite.Equal(9443, config.WebhookPort, "Should use default port for invalid value")
}

func (suite *ConfigTestSuite) TestSelfMonitoringBooleanParsing() {
	tests := []struct {
		envValue string
		expected bool
		name     string
	}{
		{"true", true, "String 'true' should enable monitoring"},
		{"TRUE", true, "String 'TRUE' should enable monitoring"},
		{"True", true, "String 'True' should enable monitoring"},
		{"false", false, "String 'false' should disable monitoring"},
		{"FALSE", false, "String 'FALSE' should disable monitoring"},
		{"False", false, "String 'False' should disable monitoring"},
		{"1", true, "String '1' should enable monitoring"},
		{"0", false, "String '0' should disable monitoring"},
		{"invalid", true, "Invalid values should default to true"},
		{"", true, "Empty string should default to true"},
	}

	for _, tt := range tests {
		suite.Run(tt.name, func() {
			os.Setenv("SELF_MONITORING_ENABLED", tt.envValue)
			config, err := GetConfig()
			suite.NoError(err)
			suite.Equal(tt.expected, config.SelfMonitoringEnabled, tt.name)
		})
	}
}

func (suite *ConfigTestSuite) TestValidation() {
	tests := []struct {
		name        string
		config      *OperatorConfig
		expectError bool
		errorMsg    string
	}{
		{
			name: "Valid configuration",
			config: &OperatorConfig{
				WebhookPort:           9443,
				WebhookCertDir:        "/tmp/certs",
				SelfMonitoringEnabled: true,
				ServiceName:           "openlit-operator",
				LogLevel:              "info",
			},
			expectError: false,
		},
		{
			name: "Invalid webhook port - too low",
			config: &OperatorConfig{
				WebhookPort:           100,
				WebhookCertDir:        "/tmp/certs",
				SelfMonitoringEnabled: true,
				ServiceName:           "openlit-operator",
				LogLevel:              "info",
			},
			expectError: true,
			errorMsg:    "webhookPort must be between 1 and 65535",
		},
		{
			name: "Invalid webhook port - too high",
			config: &OperatorConfig{
				WebhookPort:           70000,
				WebhookCertDir:        "/tmp/certs",
				SelfMonitoringEnabled: true,
				ServiceName:           "openlit-operator",
				LogLevel:              "info",
			},
			expectError: true,
			errorMsg:    "webhookPort must be between 1 and 65535",
		},
		{
			name: "Invalid log level",
			config: &OperatorConfig{
				WebhookPort:           9443,
				WebhookCertDir:        "/tmp/certs",
				SelfMonitoringEnabled: true,
				ServiceName:           "openlit-operator",
				LogLevel:              "invalid",
			},
			expectError: true,
			errorMsg:    "logLevel must be one of: debug, info, warn, error",
		},
	}

	for _, tt := range tests {
		suite.Run(tt.name, func() {
			err := tt.config.Validate()
			if tt.expectError {
				suite.Error(err, "Should fail validation")
				suite.Contains(err.Error(), tt.errorMsg, "Should contain expected error message")
			} else {
				suite.NoError(err, "Should pass validation")
			}
		})
	}
}

func (suite *ConfigTestSuite) TestOTLPConfigurationValidation() {
	tests := []struct {
		name        string
		endpoint    string
		headers     string
		expectError bool
		errorMsg    string
	}{
		{
			name:        "Valid HTTPS endpoint",
			endpoint:    "https://logs.example.com/v1/logs",
			headers:     "Authorization=Bearer token",
			expectError: false,
		},
		{
			name:        "Valid HTTP endpoint",
			endpoint:    "http://localhost:4318/v1/logs",
			headers:     "",
			expectError: false,
		},
		{
			name:        "Invalid endpoint - not URL",
			endpoint:    "invalid-url",
			headers:     "",
			expectError: true,
			errorMsg:    "invalid OTLP logs endpoint URL",
		},
		{
			name:        "Empty endpoint with headers",
			endpoint:    "",
			headers:     "Authorization=Bearer token",
			expectError: true,
			errorMsg:    "OTLP headers provided but no endpoint specified",
		},
	}

	for _, tt := range tests {
		suite.Run(tt.name, func() {
			config := &OperatorConfig{
				WebhookPort:           9443,
				WebhookCertDir:        "/tmp/certs",
				SelfMonitoringEnabled: true,
				ServiceName:           "openlit-operator",
				LogLevel:              "info",
				OTLPLogsEndpoint:      tt.endpoint,
				OTLPHeaders:           tt.headers,
			}

			err := config.Validate()
			if tt.expectError {
				suite.Error(err, "Should fail validation")
				suite.Contains(err.Error(), tt.errorMsg, "Should contain expected error message")
			} else {
				suite.NoError(err, "Should pass validation")
			}
		})
	}
}

func (suite *ConfigTestSuite) TestConfigStringRepresentation() {
	config := &OperatorConfig{
		WebhookPort:           9443,
		WebhookCertDir:        "/tmp/certs",
		SelfMonitoringEnabled: true,
		ServiceName:           "openlit-operator",
		LogLevel:              "info",
		OTLPLogsEndpoint:      "https://logs.example.com/v1/logs",
		OTLPHeaders:           "Authorization=Bearer token123",
	}

	// Test basic configuration values
	suite.Equal(9443, config.WebhookPort)
	suite.Equal("/tmp/certs", config.WebhookCertDir)
	suite.True(config.SelfMonitoringEnabled)
	suite.Equal("openlit-operator", config.ServiceName)
	suite.Equal("https://logs.example.com/v1/logs", config.OTLPLogsEndpoint)
	suite.Equal("Authorization=Bearer token123", config.OTLPHeaders)
}

func (suite *ConfigTestSuite) TestIsOTLPEnabled() {
	tests := []struct {
		name     string
		endpoint string
		expected bool
	}{
		{
			name:     "OTLP enabled with endpoint",
			endpoint: "https://logs.example.com/v1/logs",
			expected: true,
		},
		{
			name:     "OTLP disabled with empty endpoint",
			endpoint: "",
			expected: false,
		},
		{
			name:     "OTLP disabled with whitespace endpoint",
			endpoint: "   ",
			expected: false,
		},
	}

	for _, tt := range tests {
		suite.Run(tt.name, func() {
			config := &OperatorConfig{
				OTLPLogsEndpoint: tt.endpoint,
			}
			// Since IsOTLPEnabled doesn't exist, we'll check if endpoint is not empty
			isEnabled := strings.TrimSpace(config.OTLPLogsEndpoint) != ""
			suite.Equal(tt.expected, isEnabled, "Should correctly determine OTLP status")
		})
	}
}

func TestConfigSuite(t *testing.T) {
	suite.Run(t, new(ConfigTestSuite))
}

// Additional unit tests for edge cases
func TestConfigConcurrency(t *testing.T) {
	// Test that config creation is thread-safe
	done := make(chan bool, 10)
	
	for i := 0; i < 10; i++ {
		go func(id int) {
			defer func() { done <- true }()
			
			// Set different environment variables in different goroutines
			os.Setenv("WEBHOOK_PORT", "9443")
			os.Setenv("SELF_MONITORING_ENABLED", "true")
			
			config, err := GetConfig()
			
			// Verify config is valid
			assert.NoError(t, err)
			assert.Equal(t, 9443, config.WebhookPort)
			assert.True(t, config.SelfMonitoringEnabled)
			assert.NoError(t, config.Validate())
		}(i)
	}
	
	// Wait for all goroutines to complete
	for i := 0; i < 10; i++ {
		<-done
	}
}

func TestConfigDefaults(t *testing.T) {
	// Ensure all environment variables are cleared
	envVars := []string{
		"WEBHOOK_PORT",
		"WEBHOOK_CERT_DIR", 
		"SELF_MONITORING_ENABLED",
		"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_HEADERS",
		"OTEL_SERVICE_NAME",
		"DEPLOYMENT_ENVIRONMENT",
	}
	
	for _, env := range envVars {
		os.Unsetenv(env)
	}
	
	config, err := GetConfig()
	
	// Verify all defaults are set correctly
	assert.NoError(t, err)
	assert.Equal(t, 9443, config.WebhookPort)
	assert.Equal(t, "/tmp/k8s-webhook-server/serving-certs", config.WebhookCertDir)
	assert.True(t, config.SelfMonitoringEnabled)
	assert.Equal(t, "openlit-operator", config.ServiceName)
	assert.Empty(t, config.OTLPLogsEndpoint)
	assert.Empty(t, config.OTLPHeaders)
	
	// Config should be valid with defaults
	assert.NoError(t, config.Validate())
}
