package grpcserver

import (
	"context"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	colllog "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collmetric "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	colltrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"

	"github.com/openlit/openlit/otlp-receiver/internal/ingest"
	"github.com/openlit/openlit/otlp-receiver/internal/tenant"
)

type tracesServer struct {
	colltrace.UnimplementedTraceServiceServer
	svc *ingest.Service
}

type logsServer struct {
	colllog.UnimplementedLogsServiceServer
	svc *ingest.Service
}

type metricsServer struct {
	collmetric.UnimplementedMetricsServiceServer
	svc *ingest.Service
}

func New(svc *ingest.Service) *grpc.Server {
	s := grpc.NewServer()
	colltrace.RegisterTraceServiceServer(s, &tracesServer{svc: svc})
	colllog.RegisterLogsServiceServer(s, &logsServer{svc: svc})
	collmetric.RegisterMetricsServiceServer(s, &metricsServer{svc: svc})
	return s
}

func Listen(addr string, srv *grpc.Server) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	return srv.Serve(ln)
}

func authorization(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	values := md.Get("authorization")
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func mapErr(err error) error {
	if err == nil {
		return nil
	}
	if err == tenant.ErrUnauthorized || err == tenant.ErrNoTenant {
		return status.Error(codes.Unauthenticated, "unauthorized")
	}
	return status.Error(codes.Unavailable, "ingest failed")
}

func (s *tracesServer) Export(ctx context.Context, req *colltrace.ExportTraceServiceRequest) (*colltrace.ExportTraceServiceResponse, error) {
	if err := s.svc.Traces(ctx, authorization(ctx), req); err != nil {
		return nil, mapErr(err)
	}
	return &colltrace.ExportTraceServiceResponse{}, nil
}

func (s *logsServer) Export(ctx context.Context, req *colllog.ExportLogsServiceRequest) (*colllog.ExportLogsServiceResponse, error) {
	if err := s.svc.Logs(ctx, authorization(ctx), req); err != nil {
		return nil, mapErr(err)
	}
	return &colllog.ExportLogsServiceResponse{}, nil
}

func (s *metricsServer) Export(ctx context.Context, req *collmetric.ExportMetricsServiceRequest) (*collmetric.ExportMetricsServiceResponse, error) {
	if err := s.svc.Metrics(ctx, authorization(ctx), req); err != nil {
		return nil, mapErr(err)
	}
	return &collmetric.ExportMetricsServiceResponse{}, nil
}
