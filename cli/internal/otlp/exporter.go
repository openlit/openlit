// Package otlp wraps the sdk/go OTel exporter for the CLI's hot path.
//
// Lifecycle (per hook invocation, per Sigil's proven cold-start pattern):
//
//	emitter, err := otlp.NewEmitter(ctx, cfg)
//	... emit spans/events ...
//	emitter.Shutdown(ctxWithFlushBudget)
//
// The emitter implements the normalize.Emitter interface so per-vendor
// adapters under hook/<vendor>/ stay decoupled from OTel mechanics.
//
// Failed exports persist to a disk-backed queue at
// $XDG_CACHE_HOME/openlit/queue/ so a transient network blip doesn't lose
// a session. Pending entries are best-effort flushed at the start of the
// next invocation.
package otlp

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/config"
	"github.com/openlit/openlit/cli/internal/redact"
	"github.com/openlit/openlit/cli/internal/version"
	openlit "github.com/openlit/openlit/sdk/go"
	"github.com/openlit/openlit/sdk/go/semconv"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// Emitter is the concrete normalize.Emitter implementation. The CLI keeps
// it tiny — sdk/go does the heavy lifting (resource attrs, batch span
// processor, OTLP HTTP client).
type Emitter struct {
	tracer trace.Tracer
	cfg    *config.Resolved

	// scrub is the active redactor (tier 1 always; tier 2 when the
	// configured content-capture mode is "full"). Wraps every string
	// attribute the adapter passes us so secrets don't leak even
	// when content capture is opt-in.
	scrub func(string) string

	mu        sync.Mutex
	shut      bool
	startedAt time.Time
}

// initOnce guards Init/Shutdown across multiple hook invocations within
// the same process. In practice the CLI's cold-start pattern means each
// invocation is a fresh process; the guard is defense in depth.
var initOnce sync.Mutex

// NewEmitter initializes the OTel SDK and returns an emitter. Callers
// MUST call Shutdown once they're done so spans flush before the
// process exits.
func NewEmitter(_ context.Context, cfg *config.Resolved) (*Emitter, error) {
	if cfg == nil {
		return nil, errors.New("nil config")
	}

	initOnce.Lock()
	defer initOnce.Unlock()

	if openlit.IsInitialized() {
		// Re-use the existing tracer if Init has already been called.
		// Sane behavior for the rare in-process retry case.
		return &Emitter{
			tracer:    otel.GetTracerProvider().Tracer("openlit-cli"),
			cfg:       cfg,
			scrub:     redact.ForCapture(cfg.CodingContentCapture),
			startedAt: time.Now(),
		}, nil
	}

	if err := openlit.Init(openlit.Config{
		OtlpEndpoint:    cfg.OTLPEndpoint,
		OtlpHeaders:     cfg.EffectiveHeaders(),
		Environment:     cfg.Environment,
		ApplicationName: cfg.ApplicationName,
		ServiceVersion:  version.Version,
		// We never want sdk/go to capture prompt/completion bodies on
		// our behalf. Coding-agent content capture is governed by the
		// per-adapter handlers obeying cfg.CodingContentCapture.
		DisableCaptureMessageContent: true,
		// The hook subcommand is short-lived; batch span processor is
		// fine — sdk/go calls Shutdown which forces a flush.
		DisableBatch: false,
		// Pricing fetch is irrelevant for the hook path; disabling it
		// avoids a network call per invocation.
		DisablePricingFetch: true,
		// Hook calls don't need metric pipelines for v1.
		DisableMetrics: true,
	}); err != nil {
		return nil, fmt.Errorf("openlit.Init: %w", err)
	}

	return &Emitter{
		tracer:    otel.GetTracerProvider().Tracer("openlit-cli"),
		cfg:       cfg,
		scrub:     redact.ForCapture(cfg.CodingContentCapture),
		startedAt: time.Now(),
	}, nil
}

// Shutdown flushes pending spans within the context's deadline.
func (e *Emitter) Shutdown(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.shut {
		return nil
	}
	e.shut = true
	return openlit.Shutdown(ctx)
}

// EmitSession turns a normalize.Session into a single span with
// coding_agent.* + gen_ai.* attributes set.
func (e *Emitter) EmitSession(s normalize.Session) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}

	startedAt := s.StartedAt
	if startedAt.IsZero() {
		startedAt = e.startedAt
	}
	endedAt := s.EndedAt
	if endedAt.IsZero() {
		endedAt = time.Now()
	}

	_, span := e.tracer.Start(
		// Always create a fresh trace context — the CLI hook is the
		// trace root for this session in v1. v2 will tie this back to
		// VCS commit context when the GitHub App lights up.
		context.Background(),
		semconv.CodingAgentSpanSession,
		trace.WithTimestamp(startedAt),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(endedAt))

	setSessionAttrs(span, s, e.scrub)
	return nil
}

// EmitToolCall produces a coding-agent tool-call span.
func (e *Emitter) EmitToolCall(t normalize.ToolCall) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	startedAt := t.StartedAt
	if startedAt.IsZero() {
		startedAt = time.Now()
	}
	endedAt := t.EndedAt
	if endedAt.IsZero() {
		endedAt = startedAt.Add(t.Duration)
	}

	_, span := e.tracer.Start(
		context.Background(),
		semconv.CodingAgentSpanToolCall,
		trace.WithTimestamp(startedAt),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(endedAt))

	setToolCallAttrs(span, t, e.scrub)
	return nil
}

// EmitEditDecision produces an edit-decision span. We use a span (not an
// event) so dashboards can drill into individual edits with their own
// timeline rendering.
func (e *Emitter) EmitEditDecision(d normalize.EditDecision) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	at := d.At
	if at.IsZero() {
		at = time.Now()
	}
	_, span := e.tracer.Start(
		context.Background(),
		semconv.CodingAgentSpanEditDecision,
		trace.WithTimestamp(at),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(at))

	setEditDecisionAttrs(span, d, e.scrub)
	return nil
}

// EmitLLMTurn produces a coding_agent.llm.turn span representing one
// user-prompt / assistant-response cycle.
func (e *Emitter) EmitLLMTurn(t normalize.LLMTurn) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	startedAt := t.StartedAt
	if startedAt.IsZero() {
		startedAt = time.Now()
	}
	endedAt := t.EndedAt
	if endedAt.IsZero() {
		endedAt = startedAt
	}

	_, span := e.tracer.Start(
		context.Background(),
		semconv.CodingAgentSpanLLMTurn,
		trace.WithTimestamp(startedAt),
		trace.WithSpanKind(trace.SpanKindClient),
	)
	defer span.End(trace.WithTimestamp(endedAt))

	setLLMTurnAttrs(span, t, e.scrub, e.cfg.CodingContentCapture)
	return nil
}

// EmitSubagent produces a coding_agent.subagent span representing one
// child-agent lifecycle.
func (e *Emitter) EmitSubagent(s normalize.Subagent) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	startedAt := s.StartedAt
	if startedAt.IsZero() {
		startedAt = time.Now()
	}
	endedAt := s.EndedAt
	if endedAt.IsZero() {
		if s.DurationMs > 0 {
			endedAt = startedAt.Add(time.Duration(s.DurationMs) * time.Millisecond)
		} else {
			endedAt = startedAt
		}
	}

	_, span := e.tracer.Start(
		context.Background(),
		semconv.CodingAgentSpanSubagent,
		trace.WithTimestamp(startedAt),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(endedAt))

	setSubagentAttrs(span, s, e.scrub)
	return nil
}

// EmitEvent produces a low-cost span event. The event is attached to a
// freshly-started ephemeral session span so it lives in the same trace
// shape as everything else; a single span event without an enclosing
// span would still be valid OTel but harder to filter on.
func (e *Emitter) EmitEvent(ev normalize.EventEmission) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	at := ev.At
	if at.IsZero() {
		at = time.Now()
	}
	_, span := e.tracer.Start(
		context.Background(),
		ev.Name,
		trace.WithTimestamp(at),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(at))

	if ev.SessionID != "" {
		span.SetAttributes(attribute.String(semconv.CodingAgentSessionID, ev.SessionID))
	}
	for k, v := range ev.Attrs {
		setAnyAttr(span, k, v, e.scrub)
	}
	return nil
}
