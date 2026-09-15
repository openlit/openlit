package ingest

import (
	"context"
	"errors"

	colllog "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collmetric "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	colltrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	logspb "go.opentelemetry.io/proto/otlp/logs/v1"
	metricspb "go.opentelemetry.io/proto/otlp/metrics/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"

	"github.com/openlit/openlit/otlp-receiver/internal/chwrite"
	"github.com/openlit/openlit/otlp-receiver/internal/otlpconv"
	"github.com/openlit/openlit/otlp-receiver/internal/tenant"
)

type Service struct {
	Tenants *tenant.Store
	Writer  *chwrite.Writer
}

func (s *Service) Traces(ctx context.Context, authorization string, req *colltrace.ExportTraceServiceRequest) error {
	cfg, err := s.Tenants.Resolve(ctx, authorization)
	if err != nil {
		return err
	}
	rows := otlpconv.Traces(&tracepb.TracesData{ResourceSpans: req.GetResourceSpans()})
	return s.Writer.InsertTraces(ctx, cfg, rows)
}

func (s *Service) Logs(ctx context.Context, authorization string, req *colllog.ExportLogsServiceRequest) error {
	cfg, err := s.Tenants.Resolve(ctx, authorization)
	if err != nil {
		return err
	}
	rows := otlpconv.Logs(&logspb.LogsData{ResourceLogs: req.GetResourceLogs()})
	return s.Writer.InsertLogs(ctx, cfg, rows)
}

func (s *Service) Metrics(ctx context.Context, authorization string, req *collmetric.ExportMetricsServiceRequest) error {
	cfg, err := s.Tenants.Resolve(ctx, authorization)
	if err != nil {
		return err
	}
	gauges, sums := otlpconv.GaugesAndSums(&metricspb.MetricsData{ResourceMetrics: req.GetResourceMetrics()})
	if err := s.Writer.InsertGauges(ctx, cfg, gauges); err != nil {
		return err
	}
	return s.Writer.InsertSums(ctx, cfg, sums)
}

func HTTPStatus(err error) int {
	if err == nil {
		return 200
	}
	if errors.Is(err, tenant.ErrUnauthorized) || errors.Is(err, tenant.ErrNoTenant) {
		return 401
	}
	return 503
}
