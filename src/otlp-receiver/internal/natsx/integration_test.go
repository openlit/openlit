package natsx

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
)

// TestReceiverPermissions runs against a NATS server started with
// assets/nats.conf, for example:
//
//	NATS_TEST_URL=nats://127.0.0.1:14222 NATS_TEST_RECEIVER_PASSWORD=... go test ./internal/natsx
func TestReceiverPermissions(t *testing.T) {
	url := os.Getenv("NATS_TEST_URL")
	password := os.Getenv("NATS_TEST_RECEIVER_PASSWORD")
	if url == "" || password == "" {
		t.Skip("NATS_TEST_URL and NATS_TEST_RECEIVER_PASSWORD not set")
	}
	p, err := Connect(Config{
		URL: url, User: "openlit-receiver", Password: password,
		Stream: "OPENLIT_SIGNALS", Subjects: []string{"openlit.signal.>"},
		MaxAge: time.Minute, EnsureStream: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if !p.Publish("openlit.signal.o.p.prod", "", []byte(`{"v":1}`)) {
			t.Fatal("enqueue failed")
		}
	}
	if p.Publish("openlit.signal.o.p.prod", "", make([]byte, DefaultMaxMsgSize+1)) {
		t.Fatal("oversized message must be dropped")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for p.Stats().Published < 5 && ctx.Err() == nil {
		time.Sleep(50 * time.Millisecond)
	}
	st := p.Stats()
	p.Close(ctx)
	if st.Published != 5 || st.Failed != 0 || st.Dropped != 1 {
		t.Fatalf("stats = %+v (stream ensure or publish not permitted?)", st)
	}

	// The receiver user must not read signals or other users' inboxes.
	violations := make(chan error, 4)
	nc, err := nats.Connect(url, nats.UserInfo("openlit-receiver", password),
		nats.ErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) { violations <- err }))
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	for _, subject := range []string{"openlit.signal.>", "_INBOX_ENGINE.>"} {
		if _, err := nc.SubscribeSync(subject); err != nil {
			t.Fatal(err)
		}
		select {
		case err := <-violations:
			if !strings.Contains(strings.ToLower(err.Error()), "permissions violation") {
				t.Fatalf("unexpected error for %s: %v", subject, err)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("receiver was allowed to subscribe to %s", subject)
		}
	}
}
