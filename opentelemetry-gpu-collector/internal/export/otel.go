package export

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	otelprometheus "go.opentelemetry.io/otel/exporters/prometheus"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/identity"
	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/version"
)

type slogErrorHandler struct{ logger *slog.Logger }

func (h *slogErrorHandler) Handle(err error) {
	h.logger.Warn("otel sdk error", "error", err)
}

// MeterSetup holds the MeterProvider plus an optional Prometheus /metrics handler.
type MeterSetup struct {
	Provider          *metric.MeterProvider
	PrometheusHandler http.Handler // non-nil when Prometheus export is enabled
	Shutdown          func()
}

// NewMeterProvider creates an OTel MeterProvider with an OTLP PeriodicReader.
// When cfg.PrometheusAddr is non-empty, a Prometheus exporter reader is also
// attached and PrometheusHandler is set for serving /metrics.
//
// Resource identity models this process as a GPU metrics agent (host/hw
// telemetry), not an application service:
//   - telemetry.sdk.* via WithTelemetrySDK
//   - telemetry.distro.name/version for the GPU collector product identity
//   - host/k8s/cloud from identity detection
//   - service.name only when the user explicitly sets OTEL_SERVICE_NAME
func NewMeterProvider(ctx context.Context, cfg *config.Config, logger *slog.Logger) (*MeterSetup, error) {
	otel.SetErrorHandler(&slogErrorHandler{logger: logger})

	_, identityAttrs := identity.Detect(ctx, logger)

	// Soft defaults before WithFromEnv so OTEL_RESOURCE_ATTRIBUTES wins.
	softAttrs := []attribute.KeyValue{
		attribute.String("deployment.environment", cfg.Environment),
	}
	// Product identity after FromEnv so it is not overridden by env.
	distroAttrs := agentDistroAttrs(cfg)

	res, err := resource.New(ctx,
		resource.WithTelemetrySDK(),
		resource.WithOS(),
		resource.WithAttributes(identityAttrs...),
		resource.WithAttributes(softAttrs...),
		resource.WithFromEnv(),
		resource.WithAttributes(distroAttrs...),
	)
	if err != nil {
		return nil, fmt.Errorf("creating resource: %w", err)
	}

	// OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS, and
	// OTEL_EXPORTER_OTLP_PROTOCOL are read automatically by the SDK exporters
	// via their built-in env var support — no manual wiring needed.
	var exporter metric.Exporter

	protocol := os.Getenv("OTEL_EXPORTER_OTLP_PROTOCOL")
	switch protocol {
	case "http/protobuf", "http":
		exporter, err = otlpmetrichttp.New(ctx)
	default: // "grpc" or unset
		exporter, err = otlpmetricgrpc.New(ctx)
	}

	if err != nil {
		return nil, fmt.Errorf("creating OTLP exporter: %w", err)
	}

	reader := metric.NewPeriodicReader(exporter,
		metric.WithInterval(cfg.CollectionInterval),
	)

	opts := []metric.Option{
		metric.WithResource(res),
		metric.WithReader(reader),
	}

	var promHandler http.Handler
	if cfg.PrometheusAddr != "" {
		registry := prometheus.NewRegistry()
		promExporter, err := otelprometheus.New(otelprometheus.WithRegisterer(registry))
		if err != nil {
			return nil, fmt.Errorf("creating prometheus exporter: %w", err)
		}
		opts = append(opts, metric.WithReader(promExporter))
		promHandler = promhttp.HandlerFor(registry, promhttp.HandlerOpts{
			ErrorHandling: promhttp.ContinueOnError,
		})
		logger.Info("prometheus metrics exporter enabled", "addr", cfg.PrometheusAddr)
	}

	provider := metric.NewMeterProvider(opts...)

	shutdown := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := provider.Shutdown(ctx); err != nil {
			logger.Warn("meter provider shutdown (pending metrics may be lost)", "error", err)
		}
	}

	return &MeterSetup{
		Provider:          provider,
		PrometheusHandler: promHandler,
		Shutdown:          shutdown,
	}, nil
}

// agentDistroAttrs returns product identity for the metrics resource.
// service.name is left to WithFromEnv (OTEL_SERVICE_NAME) when the user sets it.
func agentDistroAttrs(cfg *config.Config) []attribute.KeyValue {
	attrs := []attribute.KeyValue{
		attribute.String("telemetry.distro.name", version.DistroName),
		attribute.String("telemetry.distro.version", version.Version),
	}
	// Explicit cfg.ServiceName only when set; keeps parity if Load() saw the env
	// but WithFromEnv ordering differs in tests.
	if cfg != nil && cfg.ServiceName != "" {
		attrs = append(attrs, attribute.String("service.name", cfg.ServiceName))
	}
	return attrs
}

// agentResourceAttrs is kept for tests covering distro + optional service.name.
func agentResourceAttrs(cfg *config.Config) []attribute.KeyValue {
	attrs := agentDistroAttrs(cfg)
	if cfg != nil && cfg.Environment != "" {
		attrs = append(attrs, attribute.String("deployment.environment", cfg.Environment))
	}
	return attrs
}
