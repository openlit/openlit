//go:build linux

package scanner

// BPF code generation is done via `make generate` (not go:generate)
// to properly auto-detect the target architecture.

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"

	"time"

	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"go.uber.org/zap"
)

const (
	eventChannelSize           = 256
	hostRefreshInterval        = 5 * time.Minute
	connScanInterval           = 30 * time.Second
	connScanInitialInterval    = 5 * time.Second
	connScanInitialBurstCycles = 6 // fast scan for the first 30s (6 × 5s)
)

// Scanner attaches kprobes to tcp_v4_connect and tcp_v6_connect to detect
// new outgoing connections, and periodically scans /proc/net/tcp to catch
// already-established connections to known LLM API endpoints.
type Scanner struct {
	objs     *llmScannerObjects
	links    []link.Link
	reader   *ringbuf.Reader
	resolver *HostResolver
	connScan *ConnScanner
	eventsCh chan LLMConnectEvent
	logger   *zap.Logger
	procRoot string
}

// New loads the BPF program, attaches kprobes, and initialises the host resolver.
func New(logger *zap.Logger, procRoot string) (*Scanner, error) {
	if procRoot == "" {
		procRoot = "/proc"
	}

	objs := &llmScannerObjects{}
	if err := loadLlmScannerObjects(objs, nil); err != nil {
		return nil, fmt.Errorf("load BPF objects: %w", err)
	}

	l4, err := link.Kprobe("tcp_v4_connect", objs.TraceV4, nil)
	if err != nil {
		objs.Close()
		return nil, fmt.Errorf("attach kprobe tcp_v4_connect: %w", err)
	}

	l6, err := link.Kprobe("tcp_v6_connect", objs.TraceV6, nil)
	if err != nil {
		l4.Close()
		objs.Close()
		return nil, fmt.Errorf("attach kprobe tcp_v6_connect: %w", err)
	}

	reader, err := ringbuf.NewReader(objs.Events)
	if err != nil {
		l6.Close()
		l4.Close()
		objs.Close()
		return nil, fmt.Errorf("create ring buffer reader: %w", err)
	}

	resolver := NewHostResolver(objs.LlmIpv4, logger)
	connScan := NewConnScanner(procRoot, logger)

	// Initial DNS resolution populates both the BPF map and the ConnScanner IP set
	RefreshAndUpdateBoth(resolver, connScan, logger)

	return &Scanner{
		objs:     objs,
		links:    []link.Link{l4, l6},
		reader:   reader,
		resolver: resolver,
		connScan: connScan,
		eventsCh: make(chan LLMConnectEvent, eventChannelSize),
		logger:   logger,
		procRoot: procRoot,
	}, nil
}

// Run starts reading BPF ring buffer events, refreshing host IPs,
// and periodically scanning /proc/net/tcp for existing connections.
// Blocks until ctx is cancelled.
func (s *Scanner) Run(ctx context.Context) {
	go s.resolver.RunRefreshLoop(ctx, hostRefreshInterval)
	go s.runConnScanLoop(ctx)
	s.readEvents(ctx)
}

// Events returns the channel that emits LLM connection events.
func (s *Scanner) Events() <-chan LLMConnectEvent {
	return s.eventsCh
}

// Close tears down kprobes, ring buffer reader, and BPF objects.
func (s *Scanner) Close() error {
	var errs []error
	if s.reader != nil {
		errs = append(errs, s.reader.Close())
	}
	for _, l := range s.links {
		errs = append(errs, l.Close())
	}
	if s.objs != nil {
		errs = append(errs, s.objs.Close())
	}
	close(s.eventsCh)
	return errors.Join(errs...)
}

// runConnScanLoop scans immediately, then does a fast initial burst every 5s,
// then settles to the normal 30s interval.
func (s *Scanner) runConnScanLoop(ctx context.Context) {
	s.doConnScan()

	ticker := time.NewTicker(connScanInitialInterval)
	defer ticker.Stop()
	burstRemaining := connScanInitialBurstCycles

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.doConnScan()
			if burstRemaining > 0 {
				burstRemaining--
				if burstRemaining == 0 {
					ticker.Reset(connScanInterval)
				}
			}
		}
	}
}

func (s *Scanner) doConnScan() {
	events := s.connScan.Scan()
	for _, ev := range events {
		select {
		case s.eventsCh <- ev:
		default:
			s.logger.Debug("event channel full, dropping conn scan event",
				zap.Uint32("pid", ev.PID),
				zap.String("provider", ev.Provider),
			)
		}
	}
}

func (s *Scanner) readEvents(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		record, err := s.reader.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return
			}
			s.logger.Warn("ring buffer read error", zap.Error(err))
			continue
		}

		ev, err := s.parseEvent(record.RawSample)
		if err != nil {
			s.logger.Debug("failed to parse BPF event", zap.Error(err))
			continue
		}

		select {
		case s.eventsCh <- ev:
		default:
			s.logger.Debug("event channel full, dropping event",
				zap.Uint32("pid", ev.PID),
				zap.String("provider", ev.Provider),
			)
		}
	}
}

func (s *Scanner) parseEvent(raw []byte) (LLMConnectEvent, error) {
	if len(raw) < 23 {
		return LLMConnectEvent{}, fmt.Errorf("event too short: %d bytes", len(raw))
	}

	pid := binary.LittleEndian.Uint32(raw[0:4])
	providerID := raw[10]

	provName, ok := providerNames[providerID]
	if !ok {
		provName = fmt.Sprintf("unknown(%d)", providerID)
	}

	return LLMConnectEvent{
		PID:      pid,
		Provider: provName,
	}, nil
}
