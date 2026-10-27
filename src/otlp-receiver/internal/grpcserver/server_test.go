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
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := probe.Addr().String()
	if err := probe.Close(); err != nil {
		t.Fatal(err)
	}
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}

	srv := New(&ingest.Service{
		Tenants: &tenant.Store{RequireKey: true},
		Limiter: tenant.NewFailLimiter(20, 60),
	})
	errc := make(chan error, 1)
	go func() {
		errc <- Listen("0.0.0.0:"+port, srv)
	}()
	t.Cleanup(func() {
		srv.Stop()
		select {
		case <-errc:
		case <-time.After(2 * time.Second):
			t.Errorf("Listen did not return")
		}
	})
	waitForAccept(t, "127.0.0.1:"+port)

	conn, err := grpc.NewClient("127.0.0.1:"+port, grpc.WithTransportCredentials(insecure.NewCredentials()))
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

func waitForAccept(t *testing.T, addr string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var last error
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
		if err == nil {
			conn.Close()
			return
		}
		last = err
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("Listen did not accept on %s: %v", addr, last)
}
