// Package natsx is a bounded, non-blocking JetStream publisher. Publishing
// never blocks or fails the ClickHouse write path: a full buffer drops and
// counts, and a NATS outage only increments failure counters.
package natsx

import (
	"context"
	"errors"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

type Config struct {
	URL          string
	User         string
	Password     string
	Token        string
	CredsFile    string
	Stream       string
	Subjects     []string
	MaxAge       time.Duration
	Buffer       int
	EnsureStream bool
}

type Stats struct {
	Published uint64 `json:"published"`
	Dropped   uint64 `json:"dropped"`
	Failed    uint64 `json:"failed"`
	Connected bool   `json:"connected"`
}

type message struct {
	subject string
	msgID   string
	data    []byte
}

type Publisher struct {
	cfg        Config
	nc         *nats.Conn
	js         jetstream.JetStream
	queue      chan message
	published  atomic.Uint64
	dropped    atomic.Uint64
	failed     atomic.Uint64
	streamOK   atomic.Bool
	lastEnsure atomic.Int64
	wg         sync.WaitGroup
	closeOnce  sync.Once
	done       chan struct{}
}

func Connect(cfg Config) (*Publisher, error) {
	if cfg.URL == "" {
		return nil, errors.New("natsx: URL is required")
	}
	if cfg.Buffer <= 0 {
		cfg.Buffer = 10000
	}
	opts := []nats.Option{
		nats.Name("openlit-otlp-receiver"),
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2 * time.Second),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				log.Printf("nats: disconnected: %v", err)
			}
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("nats: reconnected to %s", nc.ConnectedUrlRedacted())
		}),
	}
	switch {
	case cfg.CredsFile != "":
		opts = append(opts, nats.UserCredentials(cfg.CredsFile))
	case cfg.Token != "":
		opts = append(opts, nats.Token(cfg.Token))
	case cfg.User != "":
		opts = append(opts, nats.UserInfo(cfg.User, cfg.Password))
	}
	nc, err := nats.Connect(cfg.URL, opts...)
	if err != nil {
		return nil, err
	}
	js, err := jetstream.New(nc,
		jetstream.WithPublishAsyncMaxPending(4096),
		jetstream.WithPublishAsyncErrHandler(func(_ jetstream.JetStream, _ *nats.Msg, err error) {
			if err != nil {
				log.Printf("nats: async publish failed: %v", err)
			}
		}),
	)
	if err != nil {
		nc.Close()
		return nil, err
	}
	p := &Publisher{
		cfg:   cfg,
		nc:    nc,
		js:    js,
		queue: make(chan message, cfg.Buffer),
		done:  make(chan struct{}),
	}
	if !cfg.EnsureStream {
		p.streamOK.Store(true)
	}
	p.wg.Add(1)
	go p.run()
	return p, nil
}

// Publish enqueues without blocking. It reports false when the message was
// dropped because the buffer is full or the publisher is closed.
func (p *Publisher) Publish(subject, msgID string, data []byte) bool {
	select {
	case <-p.done:
		p.dropped.Add(1)
		return false
	default:
	}
	select {
	case p.queue <- message{subject: subject, msgID: msgID, data: data}:
		return true
	default:
		p.dropped.Add(1)
		return false
	}
}

func (p *Publisher) Stats() Stats {
	return Stats{
		Published: p.published.Load(),
		Dropped:   p.dropped.Load(),
		Failed:    p.failed.Load(),
		Connected: p.nc.IsConnected(),
	}
}

func (p *Publisher) ensureStream() bool {
	if p.streamOK.Load() {
		return true
	}
	if !p.nc.IsConnected() {
		return false
	}
	now := time.Now().UnixNano()
	if last := p.lastEnsure.Load(); last != 0 && now-last < int64(5*time.Second) {
		return false
	}
	p.lastEnsure.Store(now)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := p.js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:       p.cfg.Stream,
		Subjects:   p.cfg.Subjects,
		MaxAge:     p.cfg.MaxAge,
		Storage:    jetstream.FileStorage,
		Retention:  jetstream.LimitsPolicy,
		Discard:    jetstream.DiscardOld,
		Duplicates: 2 * time.Minute,
	})
	if err != nil {
		log.Printf("nats: ensure stream %s: %v", p.cfg.Stream, err)
		return false
	}
	p.streamOK.Store(true)
	log.Printf("nats: stream %s ready", p.cfg.Stream)
	return true
}

func (p *Publisher) run() {
	defer p.wg.Done()
	// Create the stream up front so consumers can attach before the first span.
	p.ensureStream()
	for {
		select {
		case msg := <-p.queue:
			p.send(msg)
		case <-p.done:
			for {
				select {
				case msg := <-p.queue:
					p.send(msg)
				default:
					return
				}
			}
		}
	}
}

func (p *Publisher) send(msg message) {
	if !p.ensureStream() {
		p.failed.Add(1)
		return
	}
	out := nats.NewMsg(msg.subject)
	out.Data = msg.data
	if msg.msgID != "" {
		out.Header.Set(jetstream.MsgIDHeader, msg.msgID)
	}
	if _, err := p.js.PublishMsgAsync(out); err != nil {
		p.failed.Add(1)
		return
	}
	p.published.Add(1)
}

func (p *Publisher) Close(ctx context.Context) {
	p.closeOnce.Do(func() {
		close(p.done)
		p.wg.Wait()
		select {
		case <-p.js.PublishAsyncComplete():
		case <-ctx.Done():
		}
		_ = p.nc.Drain()
	})
}
