package grpcserver

import (
	"context"
	"net"
	"testing"
	"time"

	colltrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"

	"github.com/openlit/openlit/otlp-receiver/internal/ingest"
	"github.com/openlit/openlit/otlp-receiver/internal/tenant"
)

// TestExportSpeaksGRPC fails if the listener accepts TCP and then drops the
// HTTP/2 preface. That is the failure Python exporters report as
// StatusCode.UNAVAILABLE / "End of TCP stream" against :4317.
func TestExportSpeaksGRPC(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := New(&ingest.Service{
		Tenants: &tenant.Store{RequireKey: true},
		Limiter: tenant.NewFailLimiter(20, 60),
	})
	go func() {
		_ = srv.Serve(ln)
	}()
	t.Cleanup(srv.Stop)

	conn, err := grpc.NewClient(ln.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = colltrace.NewTraceServiceClient(conn).Export(
		ctx,
		&colltrace.ExportTraceServiceRequest{},
		grpc.UseCompressor("gzip"),
	)
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("transport error, not a gRPC status: %v", err)
	}
	if st.Code() != codes.Unauthenticated {
		t.Fatalf("code %s: %s", st.Code(), st.Message())
	}
}
