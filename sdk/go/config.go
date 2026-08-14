package openlit

import (
	"time"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// Config holds the configuration for OpenLIT SDK initialization
type Config struct {
	// OtlpEndpoint is the OTLP endpoint for sending traces and metrics
	// Default: "http://127.0.0.1:4318"
	OtlpEndpoint string

	// OtlpHeaders are additional headers to send with OTLP requests
	OtlpHeaders map[string]string

	// Environment identifies the deployment environment
	// Default: "default"
	Environment string

	// ApplicationName is the name of your application
	// Default: "default"
	ApplicationName string

	// TracerName is the name for the tracer provider
	// Default: "openlit"
	TracerName string

	// ServiceVersion is the version of your service
	ServiceVersion string

	// DisableTracing disables trace collection
	// Default: false
	DisableTracing bool

	// DisableMetrics disables metrics collection
	// Default: false
	DisableMetrics bool

	// DisableBatch disables batch processing for exports
	// Default: false
	DisableBatch bool

	// TraceExporterTimeout is the timeout for trace exports
	// Default: 10 seconds
	TraceExporterTimeout time.Duration

	// MetricExporterTimeout is the timeout for metric exports
	// Default: 10 seconds
	MetricExporterTimeout time.Duration

	// MetricExportInterval is the interval for metric exports
	// Default: 30 seconds
	MetricExportInterval time.Duration

	// PricingInfo contains custom pricing information for models
	PricingInfo map[string]ModelPricing

	// PricingEndpoint is the endpoint to fetch pricing information
	// Default: "https://github.com/openlit/openlit/raw/main/assets/pricing.json"
	PricingEndpoint string

	// DisablePricingFetch disables automatic pricing information fetching
	DisablePricingFetch bool

	// DisableCaptureMessageContent prevents prompt/completion text from being
	// recorded as span attributes. Set to true for privacy-sensitive workloads.
	// Default: false (content IS captured, matching Python SDK default of capture_message_content=True)
	DisableCaptureMessageContent bool

	// DetailedTracing enables detailed component-level tracing.
	// Default: false
	DetailedTracing bool

	// IDGenerator overrides the default OTel ID generator. Use this when
	// callers need deterministic trace/span IDs (e.g. the openlit CLI's
	// coding-agent hook deriving a stable TraceId from a session id so
	// every span emitted across separate hook invocations lands in the
	// same trace). When nil, OTel's random generator is used.
	IDGenerator sdktrace.IDGenerator

	// Sampler overrides the default head sampler. When nil, the SDK
	// uses AlwaysSample — every span emitted reaches the collector.
	// Callers wanting a head-sampling strategy (e.g. drop noisy
	// `coding_agent.tool.requested` events) can pass a
	// ParentBasedSampler or a custom span-name aware sampler here.
	// See cli/internal/otlp/sampler.go for an example.
	Sampler sdktrace.Sampler

	// ExtraResourceAttributes are merged into the OTel Resource set on
	// every span/metric this SDK emits. Callers use this to attach
	// stable identity (e.g. `gen_ai.user.name`, `host.name`) once at
	// startup rather than tagging each span individually.
	ExtraResourceAttributes map[string]string
}

// ModelPricing represents pricing information for a model
type ModelPricing struct {
	InputCostPerToken  float64
	OutputCostPerToken float64
}

// setDefaults sets default values for the configuration
func (c *Config) setDefaults() {
	if c.OtlpEndpoint == "" {
		c.OtlpEndpoint = "http://127.0.0.1:4318"
	}

	if c.Environment == "" {
		c.Environment = "default"
	}

	if c.ApplicationName == "" {
		c.ApplicationName = "default"
	}

	if c.TracerName == "" {
		c.TracerName = "openlit"
	}

	if c.TraceExporterTimeout == 0 {
		c.TraceExporterTimeout = 10 * time.Second
	}

	if c.MetricExporterTimeout == 0 {
		c.MetricExporterTimeout = 10 * time.Second
	}

	if c.MetricExportInterval == 0 {
		c.MetricExportInterval = 30 * time.Second
	}

	if c.PricingEndpoint == "" {
		c.PricingEndpoint = "https://github.com/openlit/openlit/raw/main/assets/pricing.json"
	}

	if c.PricingInfo == nil {
		c.PricingInfo = make(map[string]ModelPricing)
	}

	if c.OtlpHeaders == nil {
		c.OtlpHeaders = make(map[string]string)
	}
}
