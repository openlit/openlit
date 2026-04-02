package export

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"

	"github.com/openlit/openlit/openlit-collector/internal/config"
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
		resource.WithAttributes(
			attribute.String("service.name", cfg.ServiceName),
			attribute.String("deployment.environment", cfg.Environment),
		),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("creating resource: %w", err)
	}

	var exporter metric.Exporter

	switch cfg.OTLPProtocol {
	case "http/protobuf", "http":
		opts := []otlpmetrichttp.Option{}
		if cfg.OTLPEndpoint != "" {
			opts = append(opts, otlpmetrichttp.WithEndpoint(endpointHost(cfg.OTLPEndpoint)))
			if isInsecure(cfg.OTLPEndpoint) {
				opts = append(opts, otlpmetrichttp.WithInsecure())
			}
		}
		for k, v := range cfg.OTLPHeaders {
			opts = append(opts, otlpmetrichttp.WithHeaders(map[string]string{k: v}))
		}
		exporter, err = otlpmetrichttp.New(ctx, opts...)
	default: // "grpc"
		opts := []otlpmetricgrpc.Option{}
		if cfg.OTLPEndpoint != "" {
			opts = append(opts, otlpmetricgrpc.WithEndpoint(endpointHost(cfg.OTLPEndpoint)))
			if isInsecure(cfg.OTLPEndpoint) {
				opts = append(opts, otlpmetricgrpc.WithInsecure())
			}
		}
		for k, v := range cfg.OTLPHeaders {
			opts = append(opts, otlpmetricgrpc.WithHeaders(map[string]string{k: v}))
		}
		exporter, err = otlpmetricgrpc.New(ctx, opts...)
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

// endpointHost strips the scheme from a URL to get the host:port for the OTLP exporter.
func endpointHost(endpoint string) string {
	for _, prefix := range []string{"https://", "http://"} {
		if len(endpoint) > len(prefix) && endpoint[:len(prefix)] == prefix {
			return endpoint[len(prefix):]
		}
	}
	return endpoint
}

func isInsecure(endpoint string) bool {
	return len(endpoint) >= 7 && endpoint[:7] == "http://"
}
