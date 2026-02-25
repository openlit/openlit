// Package openlit provides OpenTelemetry-native observability for LLM applications in Go.
// It offers automatic instrumentation for popular LLM providers like OpenAI and Anthropic.
package openlit

import (
	"context"
	"fmt"
	"log"
	"sync"

	"github.com/openlit/openlit/sdk/go/helpers"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

var (
	globalConfig   *Config
	globalShutdown func(context.Context) error
	initMutex      sync.Mutex
	isInitialized  bool
	tracerProvider *trace.TracerProvider
	meterProvider  *metric.MeterProvider
)

// Init initializes the OpenLIT SDK with the provided configuration.
// This should be called once at application startup.
//
// Example:
//
//	err := openlit.Init(openlit.Config{
//	    OtlpEndpoint:    "http://127.0.0.1:4318",
//	    Environment:     "production",
//	    ApplicationName: "my-go-app",
//	})
//	if err != nil {
//	    log.Fatalf("Failed to initialize OpenLIT: %v", err)
//	}
//	defer openlit.Shutdown(context.Background())
func Init(cfg Config) error {
	initMutex.Lock()
	defer initMutex.Unlock()

	if isInitialized {
		return fmt.Errorf("OpenLIT is already initialized")
	}

	// Set default values
	cfg.setDefaults()
	globalConfig = &cfg

	// Initialize pricing cache with user config
	customPricing := make(map[string]helpers.PricingInfo)
	for model, p := range cfg.PricingInfo {
		customPricing[model] = helpers.PricingInfo{
			InputCostPerToken:  p.InputCostPerToken,
			OutputCostPerToken: p.OutputCostPerToken,
		}
	}
	helpers.InitGlobalPricingCache(cfg.PricingEndpoint, cfg.DisablePricingFetch, customPricing)

	// Propagate capture_message_content setting to helpers (inverted: disable=false means capture=true)
	helpers.SetCaptureMessageContent(!cfg.DisableCaptureMessageContent)

	// Create resource
	res, err := newResource(cfg)
	if err != nil {
		return fmt.Errorf("failed to create resource: %w", err)
	}

	// Initialize tracer provider
	if !cfg.DisableTracing {
		tp, err := newTracerProvider(res, cfg)
		if err != nil {
			return fmt.Errorf("failed to create tracer provider: %w", err)
		}
		tracerProvider = tp
		otel.SetTracerProvider(tp)
	}

	// Initialize meter provider
	if !cfg.DisableMetrics {
		mp, err := newMeterProvider(res, cfg)
		if err != nil {
			return fmt.Errorf("failed to create meter provider: %w", err)
		}
		meterProvider = mp
		otel.SetMeterProvider(mp)
	}

	// Set global propagator
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	// Set up shutdown function
	globalShutdown = func(ctx context.Context) error {
		var err error
		if tracerProvider != nil {
			if shutdownErr := tracerProvider.Shutdown(ctx); shutdownErr != nil {
				err = shutdownErr
			}
		}
		if meterProvider != nil {
			if shutdownErr := meterProvider.Shutdown(ctx); shutdownErr != nil {
				if err != nil {
					err = fmt.Errorf("%v; %w", err, shutdownErr)
				} else {
					err = shutdownErr
				}
			}
		}
		return err
	}

	isInitialized = true
	log.Printf("OpenLIT initialized successfully (Environment: %s, Application: %s)", cfg.Environment, cfg.ApplicationName)

	return nil
}

// Shutdown gracefully shuts down the OpenLIT SDK.
// It should be called before application exit to ensure all telemetry data is flushed.
func Shutdown(ctx context.Context) error {
	initMutex.Lock()
	defer initMutex.Unlock()

	if !isInitialized {
		return nil
	}

	if globalShutdown != nil {
		err := globalShutdown(ctx)
		if err != nil {
			return fmt.Errorf("failed to shutdown OpenLIT: %w", err)
		}
	}

	isInitialized = false
	globalConfig = nil
	tracerProvider = nil
	meterProvider = nil
	globalShutdown = nil

	log.Println("OpenLIT shut down successfully")
	return nil
}

// GetConfig returns the current global configuration.
// Returns nil if OpenLIT is not initialized.
func GetConfig() *Config {
	initMutex.Lock()
	defer initMutex.Unlock()
	return globalConfig
}

// IsInitialized returns whether OpenLIT has been initialized.
func IsInitialized() bool {
	initMutex.Lock()
	defer initMutex.Unlock()
	return isInitialized
}

// newResource creates a new resource with the application metadata
func newResource(cfg Config) (*resource.Resource, error) {
	attrs := []resource.Option{
		resource.WithAttributes(
			semconv.ServiceNameKey.String(cfg.ApplicationName),
			semconv.DeploymentEnvironmentKey.String(cfg.Environment),
			attribute.String("openlit.sdk.version", Version),
		),
	}

	if cfg.ServiceVersion != "" {
		attrs = append(attrs, resource.WithAttributes(
			semconv.ServiceVersionKey.String(cfg.ServiceVersion),
		))
	}

	return resource.New(
		context.Background(),
		append(attrs, resource.WithTelemetrySDK())...,
	)
}

// newTracerProvider creates a new tracer provider with OTLP exporter
func newTracerProvider(res *resource.Resource, cfg Config) (*trace.TracerProvider, error) {
	// WithEndpointURL accepts the full URL including scheme, avoiding the
	// host-only limitation of WithEndpoint + WithInsecure.
	opts := []otlptracehttp.Option{
		otlptracehttp.WithEndpointURL(cfg.OtlpEndpoint),
		otlptracehttp.WithTimeout(cfg.TraceExporterTimeout),
	}

	if len(cfg.OtlpHeaders) > 0 {
		opts = append(opts, otlptracehttp.WithHeaders(cfg.OtlpHeaders))
	}

	exporter, err := otlptracehttp.New(context.Background(), opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create trace exporter: %w", err)
	}

	var spanProcessor trace.SpanProcessor
	if cfg.DisableBatch {
		spanProcessor = trace.NewSimpleSpanProcessor(exporter)
	} else {
		spanProcessor = trace.NewBatchSpanProcessor(exporter)
	}

	tp := trace.NewTracerProvider(
		trace.WithResource(res),
		trace.WithSpanProcessor(spanProcessor),
		trace.WithSampler(trace.AlwaysSample()),
	)

	return tp, nil
}

// newMeterProvider creates a new meter provider with OTLP exporter
func newMeterProvider(res *resource.Resource, cfg Config) (*metric.MeterProvider, error) {
	opts := []otlpmetrichttp.Option{
		otlpmetrichttp.WithEndpointURL(cfg.OtlpEndpoint),
		otlpmetrichttp.WithTimeout(cfg.MetricExporterTimeout),
	}

	if len(cfg.OtlpHeaders) > 0 {
		opts = append(opts, otlpmetrichttp.WithHeaders(cfg.OtlpHeaders))
	}

	exporter, err := otlpmetrichttp.New(context.Background(), opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create metric exporter: %w", err)
	}

	reader := metric.NewPeriodicReader(
		exporter,
		metric.WithInterval(cfg.MetricExportInterval),
	)

	mp := metric.NewMeterProvider(
		metric.WithResource(res),
		metric.WithReader(reader),
	)

	return mp, nil
}
