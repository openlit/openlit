package main

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/openlit/openlit/engine/internal/config"
)

// TestEngineNATSPermissions runs against a NATS server started with
// assets/nats.conf whose OPENLIT_SIGNALS stream already exists (the receiver
// creates it). It proves the engine user can consume but not publish signals.
func TestEngineNATSPermissions(t *testing.T) {
	url := os.Getenv("NATS_TEST_URL")
	password := os.Getenv("NATS_TEST_ENGINE_PASSWORD")
	if url == "" || password == "" {
		t.Skip("NATS_TEST_URL and NATS_TEST_ENGINE_PASSWORD not set")
	}
	cfg := config.Config{NATSURL: url, NATSUser: "openlit-engine", NATSPassword: password, Stream: "OPENLIT_SIGNALS", Replay: time.Hour}
	opts, err := natsOptions(cfg)
	if err != nil {
		t.Fatal(err)
	}
	violations := make(chan error, 4)
	opts = append(opts, nats.ErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) { violations <- err }))
	nc, err := nats.Connect(url, opts...)
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	js, err := jetstream.New(nc)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	got := make(chan struct{}, 16)
	cc, err := consume(ctx, js, cfg, func(jetstream.Msg) { got <- struct{}{} })
	if err != nil {
		t.Fatal(err)
	}
	defer cc.Stop()
	select {
	case <-got:
	case <-ctx.Done():
		t.Fatal("engine user could not consume the stream")
	}

	if err := nc.Publish("openlit.signal.o.p.prod", []byte(`{"v":1}`)); err != nil {
		t.Fatal(err)
	}
	_ = nc.Flush()
	select {
	case err := <-violations:
		if !strings.Contains(strings.ToLower(err.Error()), "permissions violation") {
			t.Fatalf("unexpected error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("engine user was allowed to publish signals")
	}
}
