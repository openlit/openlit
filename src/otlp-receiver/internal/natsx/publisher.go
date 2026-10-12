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
	TLS          TLSConfig
	Stream       string
	Subjects     []string
	MaxAge       time.Duration
	MaxBytes     int64
	MaxMsgs      int64
	MaxMsgSize   int32
	Buffer       int
	EnsureStream bool
}

// TLSConfig enables TLS (and optionally mTLS) to NATS.
type TLSConfig struct {
	CAFile   string
	CertFile string
	KeyFile  string
	Required bool
}

const (
	// inboxPrefix gives the receiver its own reply subjects so NATS
	// permissions can keep other users from reading its acknowledgements.
	inboxPrefix       = "_INBOX_RECEIVER"
	maxPendingAcks    = 4096
	DefaultMaxBytes   = 256 << 20
	DefaultMaxMsgSize = 64 << 10
)

// Stats counts messages by outcome. Published only counts messages the
// stream acknowledged; Failed counts rejected or unacknowledged ones.
type Stats struct {
	Published uint64 `json:"published"`
	Dropped   uint64 `json:"dropped"`
	Failed    uint64 `json:"failed"`
	Pending   int    `json:"pending"`
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
	acks       chan jetstream.PubAckFuture
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
	if cfg.MaxBytes <= 0 {
		cfg.MaxBytes = DefaultMaxBytes
	}
	if cfg.MaxMsgSize <= 0 {
		cfg.MaxMsgSize = DefaultMaxMsgSize
	}
	opts := []nats.Option{
		nats.Name("openlit-otlp-receiver"),
		nats.CustomInboxPrefix(inboxPrefix),
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
	default:
		log.Printf("nats: no credentials configured; production NATS must require auth")
	}
	tlsOpts, err := TLSOptions(cfg.TLS)
	if err != nil {
		return nil, err
	}
	opts = append(opts, tlsOpts...)
	nc, err := nats.Connect(cfg.URL, opts...)
	if err != nil {
		return nil, err
	}
	js, err := jetstream.New(nc,
		jetstream.WithPublishAsyncMaxPending(maxPendingAcks),
		jetstream.WithPublishAsyncTimeout(10*time.Second),
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
		acks:  make(chan jetstream.PubAckFuture, maxPendingAcks),
		done:  make(chan struct{}),
	}
	if !cfg.EnsureStream {
		p.streamOK.Store(true)
	}
	p.wg.Add(1)
	go p.run()
	go p.collectAcks()
	return p, nil
}

// TLSOptions maps TLSConfig to connection options.
func TLSOptions(cfg TLSConfig) ([]nats.Option, error) {
	if (cfg.CertFile == "") != (cfg.KeyFile == "") {
		return nil, errors.New("natsx: NATS_TLS_CERT and NATS_TLS_KEY must be set together")
	}
	var opts []nats.Option
	if cfg.CAFile != "" {
		opts = append(opts, nats.RootCAs(cfg.CAFile))
	}
	if cfg.CertFile != "" {
		opts = append(opts, nats.ClientCert(cfg.CertFile, cfg.KeyFile))
	}
	if cfg.Required {
		opts = append(opts, nats.Secure())
	}
	return opts, nil
}

// collectAcks resolves publish futures in order and counts the outcome.
func (p *Publisher) collectAcks() {
	var lastErr string
	for f := range p.acks {
		select {
		case <-f.Ok():
			p.published.Add(1)
		case err := <-f.Err():
			p.failed.Add(1)
			if err != nil && err.Error() != lastErr {
				lastErr = err.Error()
				log.Printf("nats: publish not acknowledged: %v", err)
			}
		}
	}
}

// Publish enqueues without blocking. It reports false when the message was
// dropped because the buffer is full or the publisher is closed.
func (p *Publisher) Publish(subject, msgID string, data []byte) bool {
	if len(data) > int(p.cfg.MaxMsgSize) {
		p.dropped.Add(1)
		return false
	}
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
		Pending:   p.js.PublishAsyncPending(),
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
		MaxBytes:   p.cfg.MaxBytes,
		MaxMsgs:    maxMsgs(p.cfg.MaxMsgs),
		MaxMsgSize: p.cfg.MaxMsgSize,
		Storage:    jetstream.FileStorage,
		Retention:  jetstream.LimitsPolicy,
		Discard:    jetstream.DiscardOld,
		Duplicates: duplicatesWindow(p.cfg.MaxAge),
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
	f, err := p.js.PublishMsgAsync(out)
	if err != nil {
		p.failed.Add(1)
		return
	}
	p.acks <- f
}

// duplicatesWindow keeps JetStream dedupe at 2m but never above MaxAge,
// which the server rejects.
func duplicatesWindow(maxAge time.Duration) time.Duration {
	if maxAge > 0 && maxAge < 2*time.Minute {
		return maxAge
	}
	return 2 * time.Minute
}

func maxMsgs(n int64) int64 {
	if n <= 0 {
		return -1
	}
	return n
}

func (p *Publisher) Close(ctx context.Context) {
	p.closeOnce.Do(func() {
		close(p.done)
		p.wg.Wait()
		select {
		case <-p.js.PublishAsyncComplete():
		case <-ctx.Done():
		}
		close(p.acks)
		_ = p.nc.Drain()
	})
}
