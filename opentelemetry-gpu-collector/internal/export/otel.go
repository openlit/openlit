package export

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"

	"github.com/openlit/openlit/opentelemetry-gpu-collector/internal/config"
)

type slogErrorHandler struct{ logger *slog.Logger }

func (h *slogErrorHandler) Handle(err error) {
	h.logger.Warn("otel sdk error", "error", err)
}

// NewMeterProvider creates an OTel MeterProvider configured with
// the appropriate OTLP exporter and periodic reader.
func NewMeterProvider(ctx context.Context, cfg *config.Config, logger *slog.Logger) (*metric.MeterProvider, func(), error) {
	otel.SetErrorHandler(&slogErrorHandler{logger: logger})

	res, err := resource.New(ctx,
		resource.WithHost(),
		resource.WithOS(),
		resource.WithFromEnv(), // picks up OTEL_RESOURCE_ATTRIBUTES and OTEL_SERVICE_NAME
		resource.WithAttributes(
			attribute.String("service.name", cfg.ServiceName),
			attribute.String("deployment.environment", cfg.Environment),
		),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("creating resource: %w", err)
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
		return nil, nil, fmt.Errorf("creating OTLP exporter: %w", err)
	}

	reader := metric.NewPeriodicReader(exporter,
		metric.WithInterval(cfg.CollectionInterval),
	)

	provider := metric.NewMeterProvider(
		metric.WithResource(res),
		metric.WithReader(reader),
	)

	shutdown := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := provider.Shutdown(ctx); err != nil {
			logger.Warn("meter provider shutdown (pending metrics may be lost)", "error", err)
		}
	}

	return provider, shutdown, nil
}

