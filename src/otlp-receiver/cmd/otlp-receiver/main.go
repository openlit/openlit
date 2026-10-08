package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/openlit/openlit/otlp-receiver/internal/chwrite"
	"github.com/openlit/openlit/otlp-receiver/internal/config"
	"github.com/openlit/openlit/otlp-receiver/internal/grpcserver"
	"github.com/openlit/openlit/otlp-receiver/internal/httpserver"
	"github.com/openlit/openlit/otlp-receiver/internal/ingest"
	"github.com/openlit/openlit/otlp-receiver/internal/natsx"
	"github.com/openlit/openlit/otlp-receiver/internal/realtime"
	sigpkg "github.com/openlit/openlit/otlp-receiver/internal/signal"
	"github.com/openlit/openlit/otlp-receiver/internal/tenant"
)

func main() {
	cfg := config.Load()
	tenants, err := tenant.Open(cfg)
	if err != nil {
		log.Fatalf("tenant store: %v", err)
	}
	defer tenants.Close()

	svc := &ingest.Service{Tenants: tenants, Writer: chwrite.New()}
	defer svc.Writer.Close()

	var publisher *natsx.Publisher
	var fanout *realtime.Fanout
	if cfg.NATS.URL != "" {
		publisher, err = natsx.Connect(natsx.Config{
			URL:          cfg.NATS.URL,
			User:         cfg.NATS.User,
			Password:     cfg.NATS.Password,
			Token:        cfg.NATS.Token,
			CredsFile:    cfg.NATS.CredsFile,
			Stream:       cfg.NATS.Stream,
			Subjects:     []string{sigpkg.SubjectPrefix + ".>"},
			MaxAge:       cfg.NATS.MaxAge,
			Buffer:       cfg.NATS.Buffer,
			EnsureStream: cfg.NATS.EnsureStream,
		})
		if err != nil {
			log.Fatalf("nats: %v", err)
		}
		fanout = realtime.New(publisher)
		svc.Fanout = fanout
		log.Printf("Realtime fan-out enabled (stream %s)", cfg.NATS.Stream)
	}

	stats := func() any {
		out := map[string]any{"realtime_enabled": publisher != nil}
		if publisher != nil {
			out["nats"] = publisher.Stats()
			out["fanout"] = fanout.Stats()
		}
		return out
	}

	httpSrv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpserver.NewWithStats(svc, stats),
		ReadHeaderTimeout: 10 * time.Second,
	}
	grpcSrv := grpcserver.New(svc)

	go func() {
		log.Printf("OTLP HTTP listening on %s", cfg.HTTPAddr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("otlp http: %v", err)
		}
	}()
	go func() {
		log.Printf("OTLP gRPC listening on %s", cfg.GRPCAddr)
		if err := grpcserver.Listen(cfg.GRPCAddr, grpcSrv); err != nil {
			log.Fatalf("otlp grpc: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(ctx)
	grpcSrv.GracefulStop()
	if publisher != nil {
		publisher.Close(ctx)
	}
}
