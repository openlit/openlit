package otlp

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	otrace "go.opentelemetry.io/otel/trace"
)

// newTestTracer builds a tracer that mirrors the production wiring —
// our `sessionIDGenerator` plus a synchronous in-memory exporter — so a
// test can drive the same code paths the real Emitter takes without
// going through openlit.Init's HTTP exporter.
func newTestTracer(t *testing.T) (otrace.Tracer, *tracetest.InMemoryExporter, func()) {
	t.Helper()
	exp := tracetest.NewInMemoryExporter()
	tp := trace.NewTracerProvider(
		// SimpleSpanProcessor flushes synchronously — `tracer.Start +
		// span.End` is enough; no explicit force-flush call needed.
		trace.WithSpanProcessor(trace.NewSimpleSpanProcessor(exp)),
		trace.WithIDGenerator(sessionIDGenerator{}),
	)
	tracer := tp.Tracer("openlit-cli-test")
	return tracer, exp, func() {
		_ = tp.Shutdown(context.Background())
	}
}

func TestSessionTraceContext_DerivesStableIDs(t *testing.T) {
	const sessionID = "sess-abc-123"
	const vendor = "cursor"

	tid1 := deriveSessionTraceID(sessionID, vendor)
	tid2 := deriveSessionTraceID(sessionID, vendor)
	if tid1 != tid2 {
		t.Fatalf("traceID not stable across calls: %v vs %v", tid1, tid2)
	}
	if !tid1.IsValid() {
		t.Fatalf("derived traceID must be non-zero")
	}

	rid1 := deriveSessionRootSpanID(sessionID, vendor)
	rid2 := deriveSessionRootSpanID(sessionID, vendor)
	if rid1 != rid2 {
		t.Fatalf("rootSpanID not stable across calls: %v vs %v", rid1, rid2)
	}
	if !rid1.IsValid() {
		t.Fatalf("derived rootSpanID must be non-zero")
	}

	// Different sessions must produce different ids.
	otherTID := deriveSessionTraceID("sess-other", vendor)
	if otherTID == tid1 {
		t.Fatalf("trace ids collided across distinct sessions")
	}

	// Same session id but different vendor must produce different
	// trace ids — this is the nested-agent isolation contract.
	differentVendorTID := deriveSessionTraceID(sessionID, "claude-code")
	if differentVendorTID == tid1 {
		t.Fatalf("trace ids collided across vendors for the same session id; nested-agent isolation broken")
	}
	differentVendorRID := deriveSessionRootSpanID(sessionID, "claude-code")
	if differentVendorRID == rid1 {
		t.Fatalf("root span ids collided across vendors for the same session id")
	}
}

func TestSessionTraceContext_EmptySessionPassthrough(t *testing.T) {
	parent := context.Background()
	got := sessionTraceContext(parent, "", "cursor")
	if got != parent {
		t.Fatalf("sessionTraceContext('') must return parent unchanged so non-coding callers are untouched")
	}
	got = sessionRootContext(parent, "", "cursor")
	if got != parent {
		t.Fatalf("sessionRootContext('') must return parent unchanged")
	}
}

// TestEmitFlow_OneTracePerSession is the single most important
// regression: every emission for the same `coding_agent.session.id`
// MUST land in one OTel trace, with the session-root span's SpanID
// reused as ParentSpanId by every child. PR #1200's TraceDetailView
// will not render the timeline correctly without this property.
func TestEmitFlow_OneTracePerSession(t *testing.T) {
	tracer, exp, done := newTestTracer(t)
	defer done()

	const sessionID = "session-emitflow-001"
	const vendor = "cursor"

	// 1) Session-root span — uses sessionRootContext so the IDGenerator
	//    returns the deterministic (traceID, rootSpanID).
	_, sessSpan := tracer.Start(
		sessionRootContext(context.Background(), sessionID, vendor),
		"coding_agent.session",
	)
	sessSpan.End()

	// 2..5) Children — use sessionTraceContext so they inherit the
	//      derived TraceID and stamp the deterministic rootSpanID as
	//      their ParentSpanId.
	for _, name := range []string{
		"coding_agent.llm.turn",
		"coding_agent.tool_call",
		"coding_agent.edit_decision",
		"coding_agent.subagent",
	} {
		_, sp := tracer.Start(
			sessionTraceContext(context.Background(), sessionID, vendor),
			name,
		)
		sp.End()
	}

	stubs := exp.GetSpans()
	if len(stubs) != 5 {
		t.Fatalf("expected 5 spans (session + 4 children), got %d", len(stubs))
	}

	expectedTraceID := deriveSessionTraceID(sessionID, vendor)
	expectedRootSpanID := deriveSessionRootSpanID(sessionID, vendor)

	var sessionSpan tracetest.SpanStub
	var children []tracetest.SpanStub
	for _, s := range stubs {
		if s.Name == "coding_agent.session" {
			sessionSpan = s
			continue
		}
		children = append(children, s)
	}

	if got := sessionSpan.SpanContext.TraceID(); got != expectedTraceID {
		t.Fatalf("session span TraceID mismatch: want %v got %v", expectedTraceID, got)
	}
	if got := sessionSpan.SpanContext.SpanID(); got != expectedRootSpanID {
		t.Fatalf("session span SpanID must equal derived rootSpanID: want %v got %v", expectedRootSpanID, got)
	}
	// The session-root span has no parent — its parent SpanContext
	// must be invalid (all zeros).
	if sessionSpan.Parent.IsValid() {
		t.Fatalf("session span must be a trace root; got parent=%v", sessionSpan.Parent)
	}

	if len(children) != 4 {
		t.Fatalf("expected 4 child spans, got %d", len(children))
	}
	for _, c := range children {
		if c.SpanContext.TraceID() != expectedTraceID {
			t.Fatalf("%s TraceID mismatch: want %v got %v",
				c.Name, expectedTraceID, c.SpanContext.TraceID())
		}
		if c.Parent.SpanID() != expectedRootSpanID {
			t.Fatalf("%s ParentSpanID mismatch: want %v got %v",
				c.Name, expectedRootSpanID, c.Parent.SpanID())
		}
		// Children must have their own random SpanIDs — not the root's.
		if c.SpanContext.SpanID() == expectedRootSpanID {
			t.Fatalf("%s reuses rootSpanID as its own SpanID; children must get random SpanIDs",
				c.Name)
		}
	}
}

// TestEmitFlow_DistinctSessionsAreDistinctTraces guards against any
// global-state leak in `sessionIDGenerator` — two sessions emitted in
// the same process must produce two separate traces.
func TestEmitFlow_DistinctSessionsAreDistinctTraces(t *testing.T) {
	tracer, exp, done := newTestTracer(t)
	defer done()

	const vendor = "cursor"
	for _, sid := range []string{"sess-A", "sess-B"} {
		_, sp := tracer.Start(sessionRootContext(context.Background(), sid, vendor), "coding_agent.session")
		sp.End()
		_, child := tracer.Start(sessionTraceContext(context.Background(), sid, vendor), "coding_agent.tool_call")
		child.End()
	}

	stubs := exp.GetSpans()
	if len(stubs) != 4 {
		t.Fatalf("expected 4 spans (2 sessions × 2 spans), got %d", len(stubs))
	}

	tidA := deriveSessionTraceID("sess-A", vendor)
	tidB := deriveSessionTraceID("sess-B", vendor)
	countA, countB := 0, 0
	for _, s := range stubs {
		switch s.SpanContext.TraceID() {
		case tidA:
			countA++
		case tidB:
			countB++
		default:
			t.Fatalf("span %s has unexpected TraceID %v", s.Name, s.SpanContext.TraceID())
		}
	}
	if countA != 2 || countB != 2 {
		t.Fatalf("expected 2 spans per session, got A=%d B=%d", countA, countB)
	}
}

// TestEmitFlow_NestedAgentIsolation is the new contract that came out
// of the May-2026 "cursor session leaked into claude-code list" bug:
// when Claude Code runs INSIDE Cursor's terminal, both hooks may see
// the SAME session id (Cursor's chat UUID propagates via env), but
// the two vendors' spans must still land in TWO traces so the UI can
// show one Cursor session and one Claude Code session for the same
// chat thread, not one merged row.
func TestEmitFlow_NestedAgentIsolation(t *testing.T) {
	tracer, exp, done := newTestTracer(t)
	defer done()

	const sharedSessionID = "shared-chat-id"

	for _, vendor := range []string{"cursor", "claude-code"} {
		_, sp := tracer.Start(sessionRootContext(context.Background(), sharedSessionID, vendor), "coding_agent.session")
		sp.End()
	}

	stubs := exp.GetSpans()
	if len(stubs) != 2 {
		t.Fatalf("expected 2 spans (one per vendor), got %d", len(stubs))
	}
	if stubs[0].SpanContext.TraceID() == stubs[1].SpanContext.TraceID() {
		t.Fatalf("nested-agent isolation broken: vendors share trace id %v", stubs[0].SpanContext.TraceID())
	}
}

func TestSessionIDGenerator_FallsBackToRandomWithoutMarker(t *testing.T) {
	gen := sessionIDGenerator{}
	// No marker in ctx — must yield random, valid ids.
	tid, sid := gen.NewIDs(context.Background())
	if !tid.IsValid() || !sid.IsValid() {
		t.Fatalf("expected valid random ids without marker, got tid=%v sid=%v", tid, sid)
	}
	tid2, sid2 := gen.NewIDs(context.Background())
	if tid == tid2 || sid == sid2 {
		t.Fatalf("random generator must not collide on consecutive calls")
	}
}
