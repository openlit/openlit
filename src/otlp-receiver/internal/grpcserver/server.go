package grpcserver

import (
	"context"
	"errors"
	"log"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	_ "google.golang.org/grpc/encoding/gzip" // OTLP clients send grpc-encoding=gzip
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"

	colllog "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collmetric "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	colltrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"

	"github.com/openlit/openlit/otlp-receiver/internal/ingest"
	"github.com/openlit/openlit/otlp-receiver/internal/listen"
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

// maxMessageBytes matches the HTTP receiver. The gRPC default of 4MiB
// rejects larger OTLP batches that the HTTP path accepts.
const maxMessageBytes = 32 << 20

func New(svc *ingest.Service) *grpc.Server {
	s := grpc.NewServer(
		grpc.MaxRecvMsgSize(maxMessageBytes),
		grpc.MaxSendMsgSize(maxMessageBytes),
	)
	colltrace.RegisterTraceServiceServer(s, &tracesServer{svc: svc})
	colllog.RegisterLogsServiceServer(s, &logsServer{svc: svc})
	collmetric.RegisterMetricsServiceServer(s, &metricsServer{svc: svc})
	return s
}

func Listen(addr string, srv *grpc.Server) error {
	lns, err := listen.TCP(addr)
	if err != nil {
		return err
	}
	if len(lns) == 1 {
		return ignoreStopped(srv.Serve(lns[0]))
	}
	errc := make(chan error, len(lns))
	for _, ln := range lns {
		go func(ln net.Listener) {
			errc <- srv.Serve(ln)
		}(ln)
	}
	first := <-errc
	for _, ln := range lns {
		_ = ln.Close()
	}
	for i := 1; i < len(lns); i++ {
		<-errc
	}
	return ignoreStopped(first)
}

func ignoreStopped(err error) error {
	if errors.Is(err, grpc.ErrServerStopped) {
		return nil
	}
	return err
}

func authorization(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	return tenant.Credential(first(md.Get("authorization")), first(md.Get("x-openlit-api-key")))
}

func clientIP(ctx context.Context) string {
	p, ok := peer.FromContext(ctx)
	if !ok || p.Addr == nil {
		return ""
	}
	return tenant.ClientIP(p.Addr.String())
}

func first(values []string) string {
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
	if err == tenant.ErrRateLimited {
		return status.Error(codes.ResourceExhausted, "too many failed authentication attempts")
	}
	log.Printf("otlp/grpc: ingest failed: %v", err)
	return status.Error(codes.Unavailable, "ingest failed")
}

func (s *tracesServer) Export(ctx context.Context, req *colltrace.ExportTraceServiceRequest) (*colltrace.ExportTraceServiceResponse, error) {
	if err := s.svc.Traces(ctx, clientIP(ctx), authorization(ctx), req); err != nil {
		return nil, mapErr(err)
	}
	return &colltrace.ExportTraceServiceResponse{}, nil
}

func (s *logsServer) Export(ctx context.Context, req *colllog.ExportLogsServiceRequest) (*colllog.ExportLogsServiceResponse, error) {
	if err := s.svc.Logs(ctx, clientIP(ctx), authorization(ctx), req); err != nil {
		return nil, mapErr(err)
	}
	return &colllog.ExportLogsServiceResponse{}, nil
}

func (s *metricsServer) Export(ctx context.Context, req *collmetric.ExportMetricsServiceRequest) (*collmetric.ExportMetricsServiceResponse, error) {
	if err := s.svc.Metrics(ctx, clientIP(ctx), authorization(ctx), req); err != nil {
		return nil, mapErr(err)
	}
	return &collmetric.ExportMetricsServiceResponse{}, nil
}
