// Package otlp — see exporter.go for the package overview.
//
// This file makes every span emitted across separate hook invocations
// for the same coding-agent session land in the same OTel trace, with
// a stable session-root span the children all reference as parent.
//
// Why we need it
// --------------
// Each Cursor / Claude Code / Codex hook fires its own
// `openlit coding hook` process. Without coordination every emitted
// span would generate its own random TraceId — the otel_traces table
// would have one trace per emit, correlated only by the
// `coding_agent.session.id` attribute. The new trace-detail UI
// (PR #1200's `TraceDetailView` + `SpanHierarchyExplorer`) walks the
// trace tree by TraceId+ParentSpanId, so it would show one orphan
// span per hook event instead of a real session timeline.
//
// How it works
// ------------
//   - traceID = first 16 bytes of HMAC(session_id + "|" + vendor)            (stable across processes)
//   - rootSpanID = first 8 bytes of HMAC(session_id + "|" + vendor + "|root") (stable across processes)
//
// The vendor is mixed into the derivation so an agent running INSIDE
// another agent (e.g. Claude Code launched from a Cursor terminal) gets
// its own trace even when the host editor leaks its session id into
// the guest's environment. Without this, both vendors' spans would
// collapse onto the same TraceID and the trace-detail view would
// interleave them — the user explicitly wants per-vendor isolation
// ("cursor chat in cursor sessions, claude code chats in claude code
// sessions no matter the terminal").
//
// For NON-session emissions (LLMTurn, ToolCall, EditDecision, Subagent,
// Event), we wrap the parent context with `sessionTraceContext` which
// installs a remote SpanContext carrying the deterministic TraceID +
// rootSpanID. OTel's Start sees a valid parent and reuses the TraceID;
// the new span gets a random SpanID and the deterministic rootSpanID
// as its ParentSpanId.
//
// For the SESSION span itself we use `sessionRootContext`, which marks
// the context with a sentinel value but DOES NOT set a parent
// SpanContext — so OTel treats the span as a trace root and asks our
// custom IDGenerator (`sessionIDGenerator`) for fresh IDs. The
// generator's NewIDs() reads the sentinel and returns the deterministic
// (traceID, rootSpanID); for every other span it falls back to random.
package otlp

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"os"

	"go.opentelemetry.io/otel/sdk/trace"
	otrace "go.opentelemetry.io/otel/trace"
)

// Per-deployment salt mixed into the derived TraceID so the session id
// can't be reverse-engineered from the trace id. Without the salt, an
// adversary observing TraceIDs (e.g. via shared logging infrastructure)
// could probe candidate session ids and confirm matches by recomputing
// the hash.
//
// HMAC-SHA256 instead of plain sha256 makes the salt the key, so
// without it the TraceID looks like a uniform random value. We read
// the salt once at package init from `OPENLIT_TRACEID_SALT`;
// deployments are expected to set a long-lived random value (e.g.
// 32-byte hex). When the env var is unset, we fall back to an empty
// key — the TraceID stays stable across processes as long as the
// salt is stable, which is the correlation guarantee we need.
var traceIDSalt = func() []byte {
	if v := os.Getenv("OPENLIT_TRACEID_SALT"); v != "" {
		return []byte(v)
	}
	return nil
}()

// sessionRootMarkerKey is the context key used to flag the in-flight
// session-root span so `sessionIDGenerator.NewIDs` returns deterministic
// IDs derived from the carried session id. We keep it private so only
// this file can emit a session-root span.
type sessionRootMarkerKey struct{}

// sessionRootMarker carries the session id + vendor along with the
// marker. Vendor is mixed into the deterministic derivation so an
// agent running INSIDE another agent (e.g. Claude Code launched from
// a Cursor terminal) gets a distinct trace even when the host's
// session id leaks into the guest's environment.
type sessionRootMarker struct {
	sessionID string
	vendor    string
}

// deriveSessionTraceID produces a deterministic 16-byte TraceID from a
// (session id, vendor) pair. Two CLI invocations that share BOTH
// values derive the same TraceID without coordinating via shared
// storage; two invocations that differ in vendor get distinct traces
// so the trace-detail view never interleaves a Cursor turn with a
// Claude Code turn for the same chat id.
//
// F1: keyed with `OPENLIT_TRACEID_SALT` via HMAC-SHA256 so neither the
// session id nor the vendor can be brute-forced back from the
// TraceID.
func deriveSessionTraceID(sessionID, vendor string) otrace.TraceID {
	mac := hmac.New(sha256.New, traceIDSalt)
	mac.Write([]byte(sessionID + "|" + vendor))
	sum := mac.Sum(nil)
	var tid otrace.TraceID
	copy(tid[:], sum[:16])
	return tid
}

// deriveSessionRootSpanID produces a deterministic 8-byte SpanID for the
// session-root span. Children stamp this as their ParentSpanId so the
// trace tree resolves cleanly.
//
// Mirrors deriveSessionTraceID's vendor mixing so each vendor's
// session-root span has a unique SpanID even when the chat id matches.
func deriveSessionRootSpanID(sessionID, vendor string) otrace.SpanID {
	mac := hmac.New(sha256.New, traceIDSalt)
	mac.Write([]byte(sessionID + "|" + vendor + "|root"))
	sum := mac.Sum(nil)
	var sid otrace.SpanID
	copy(sid[:], sum[:8])
	return sid
}

// sessionTraceContext wraps `parent` with a remote SpanContext that
// carries the deterministic (traceID, rootSpanID) for the (session,
// vendor) pair. Use this for every NON-session emission so OTel
// treats the span as a child of the session root.
//
// When sessionID is empty the parent context is returned unchanged —
// callers that have no session correlation (e.g. ad-hoc debug events)
// keep their existing behavior.
func sessionTraceContext(parent context.Context, sessionID, vendor string) context.Context {
	if sessionID == "" {
		return parent
	}
	sc := otrace.NewSpanContext(otrace.SpanContextConfig{
		TraceID:    deriveSessionTraceID(sessionID, vendor),
		SpanID:     deriveSessionRootSpanID(sessionID, vendor),
		TraceFlags: otrace.FlagsSampled,
		Remote:     true,
	})
	return otrace.ContextWithSpanContext(parent, sc)
}

// sessionRootContext flags `parent` so the next span started against it
// will be treated by `sessionIDGenerator` as the session-root span and
// receive deterministic ids.
//
// The session-root span MUST have NO parent SpanContext on its starting
// context — OTel's tracer.Start only calls IDGenerator.NewIDs (which
// produces both TraceID and SpanID) when the parent context lacks a
// valid SpanContext. So this helper deliberately does NOT install a
// SpanContext; it only stamps the marker.
func sessionRootContext(parent context.Context, sessionID, vendor string) context.Context {
	if sessionID == "" {
		return parent
	}
	return context.WithValue(parent, sessionRootMarkerKey{}, sessionRootMarker{sessionID: sessionID, vendor: vendor})
}

// sessionIDGenerator is the trace.IDGenerator wired into the SDK. It
// returns deterministic ids when the context carries a sessionRootMarker
// (i.e. when starting a coding-agent session-root span); otherwise it
// falls back to crypto/rand-backed random ids so every other span keeps
// the standard OTel uniqueness guarantees.
type sessionIDGenerator struct{}

// NewIDs is invoked by OTel when a span has no parent SpanContext —
// i.e. when we are starting a trace root. We treat the root as the
// session span when the marker is present.
func (sessionIDGenerator) NewIDs(ctx context.Context) (otrace.TraceID, otrace.SpanID) {
	if marker, ok := ctx.Value(sessionRootMarkerKey{}).(sessionRootMarker); ok && marker.sessionID != "" {
		return deriveSessionTraceID(marker.sessionID, marker.vendor), deriveSessionRootSpanID(marker.sessionID, marker.vendor)
	}
	return randomTraceID(), randomSpanID()
}

// NewSpanID is invoked when starting a child span. Children get random
// SpanIDs unconditionally — the determinism only matters for the
// session-root SpanId so children can reference it as ParentSpanId.
func (sessionIDGenerator) NewSpanID(_ context.Context, _ otrace.TraceID) otrace.SpanID {
	return randomSpanID()
}

// Compile-time assertion that we implement the SDK contract.
var _ trace.IDGenerator = sessionIDGenerator{}

func randomTraceID() otrace.TraceID {
	var tid otrace.TraceID
	for {
		_, _ = rand.Read(tid[:])
		if tid.IsValid() {
			return tid
		}
	}
}

func randomSpanID() otrace.SpanID {
	var sid otrace.SpanID
	for {
		_, _ = rand.Read(sid[:])
		if sid.IsValid() {
			return sid
		}
	}
}
