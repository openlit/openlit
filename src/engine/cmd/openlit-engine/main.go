package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/openlit/openlit/engine/internal/api"
	"github.com/openlit/openlit/engine/internal/config"
	"github.com/openlit/openlit/engine/internal/engine"
	sig "github.com/openlit/openlit/engine/internal/signal"
)

const subjectFilter = "openlit.signal.>"

func main() {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client := api.New(cfg.OpenLITURL, cfg.CronSecret)
	defer client.Close()
	eng := engine.New(client)

	var rejected atomic.Uint64
	go refreshRules(ctx, client, eng, cfg.RulesInterval)
	go tick(ctx, eng, cfg.TickInterval)
	go serveHTTP(ctx, cfg.HTTPAddr, cfg.CronSecret, eng, func() any {
		return map[string]any{"engine": eng.Stats(), "delivery": client.Stats(), "rejected": rejected.Load()}
	})

	nc, err := nats.Connect(cfg.NATSURL, natsOptions(cfg)...)
	if err != nil {
		log.Fatalf("nats: %v", err)
	}
	defer nc.Drain()
	js, err := jetstream.New(nc)
	if err != nil {
		log.Fatalf("jetstream: %v", err)
	}

	consumeCtx, err := consume(ctx, js, cfg, func(msg jetstream.Msg) {
		var s sig.Signal
		if err := json.Unmarshal(msg.Data(), &s); err != nil || !subjectMatches(msg.Subject(), s) {
			rejected.Add(1)
			return
		}
		at := time.Now()
		if md, err := msg.Metadata(); err == nil {
			at = md.Timestamp
		}
		eng.Observe(s, at)
	})
	if err != nil {
		log.Fatalf("consume: %v", err)
	}
	log.Printf("openlit-engine consuming %s from stream %s", subjectFilter, cfg.Stream)
	<-ctx.Done()
	consumeCtx.Stop()
}

func natsOptions(cfg config.Config) []nats.Option {
	opts := []nats.Option{
		nats.Name("openlit-engine"),
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2 * time.Second),
	}
	switch {
	case cfg.NATSCreds != "":
		opts = append(opts, nats.UserCredentials(cfg.NATSCreds))
	case cfg.NATSToken != "":
		opts = append(opts, nats.Token(cfg.NATSToken))
	case cfg.NATSUser != "":
		opts = append(opts, nats.UserInfo(cfg.NATSUser, cfg.NATSPassword))
	}
	return opts
}

// consume waits for the stream to exist, then replays the last cfg.Replay of
// signals through an ordered consumer so windows are rebuilt after restarts.
func consume(ctx context.Context, js jetstream.JetStream, cfg config.Config, handle func(jetstream.Msg)) (jetstream.ConsumeContext, error) {
	var lastErr string
	for {
		start := time.Now().Add(-cfg.Replay)
		cons, err := js.OrderedConsumer(ctx, cfg.Stream, jetstream.OrderedConsumerConfig{
			FilterSubjects: []string{subjectFilter},
			DeliverPolicy:  jetstream.DeliverByStartTimePolicy,
			OptStartTime:   &start,
		})
		if err == nil {
			log.Printf("engine: consuming stream %s", cfg.Stream)
			return cons.Consume(handle)
		}
		if err.Error() != lastErr {
			lastErr = err.Error()
			log.Printf("engine: waiting for stream %s: %v", cfg.Stream, err)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
}

func refreshRules(ctx context.Context, client *api.Client, eng *engine.Engine, every time.Duration) {
	load := func() {
		reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		rs, err := client.FetchRules(reqCtx)
		if err != nil {
			log.Printf("engine: fetch rules: %v", err)
			return
		}
		log.Printf("engine: %d active rules", eng.SetRules(rs))
	}
	load()
	t := time.NewTicker(every)
	defer t.Stop()
	fast := time.NewTicker(5 * time.Second)
	defer fast.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-fast.C:
			if eng.Stats().Rules == 0 {
				load()
			}
		case <-t.C:
			load()
		}
	}
}

func tick(ctx context.Context, eng *engine.Engine, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			eng.Tick()
		}
	}
}

func serveHTTP(ctx context.Context, addr, secret string, eng *engine.Engine, stats func() any) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/stats", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(stats())
	})
	mux.HandleFunc("/signals", func(w http.ResponseWriter, r *http.Request) {
		signalsHandler(w, r, secret, eng)
	})
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("engine http: %v", err)
	}
}

var tenantToken = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

func secretEqual(got, want string) bool {
	if got == "" || want == "" || len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

// signalsHandler lists recent signals for one tenant. The caller must send the
// shared cron secret; the response never includes another tenant's spans.
func signalsHandler(w http.ResponseWriter, r *http.Request, secret string, eng *engine.Engine) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !secretEqual(r.Header.Get("X-CRON-JOB"), secret) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	q := r.URL.Query()
	org, project, env := q.Get("organisation_id"), q.Get("project_id"), q.Get("environment")
	if !tenantToken.MatchString(org) || !tenantToken.MatchString(project) || !tenantToken.MatchString(env) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	limit := 100
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 200 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		limit = n
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"signals": eng.Recent(org, project, env, limit),
	})
}

// subjectMatches rejects messages whose payload tenant differs from the
// subject tenant, so a misrouted or forged payload cannot be evaluated under
// another tenant's identity.
func subjectMatches(subject string, s sig.Signal) bool {
	parts := strings.Split(subject, ".")
	if len(parts) != 5 || parts[0] != "openlit" || parts[1] != "signal" {
		return false
	}
	return parts[2] == s.OrganisationID && parts[3] == s.ProjectID && parts[4] == envToken(s.Environment) && parts[4] != ""
}

func envToken(env string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(env) {
		switch {
		case r == '_':
			b.WriteString("__")
		case r == '.':
			b.WriteString("_d")
		case r == '-' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
		default:
			return ""
		}
	}
	return b.String()
}
