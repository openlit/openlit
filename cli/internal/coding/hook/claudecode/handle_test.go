package claudecode

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/coding/sessionstate"
)

// recordingEmitter mirrors the codex package's test emitter. We keep
// a local copy rather than share one across packages because each
// vendor adapter ends up needing slightly different assertion
// helpers — sharing risked accidental coupling across vendors that
// blurs the canonical-schema boundary the convention rule enforces.
type recordingEmitter struct {
	sessions      []normalize.Session
	toolCalls     []normalize.ToolCall
	editDecisions []normalize.EditDecision
	llmTurns      []normalize.LLMTurn
	subagents     []normalize.Subagent
	events        []normalize.EventEmission
	gitCommits    []normalize.GitCommit
	gitPRs        []normalize.GitPullRequest
}

func (e *recordingEmitter) EmitSession(s normalize.Session) error {
	e.sessions = append(e.sessions, s)
	return nil
}
func (e *recordingEmitter) EmitToolCall(t normalize.ToolCall) error {
	e.toolCalls = append(e.toolCalls, t)
	return nil
}
func (e *recordingEmitter) EmitEditDecision(d normalize.EditDecision) error {
	e.editDecisions = append(e.editDecisions, d)
	return nil
}
func (e *recordingEmitter) EmitLLMTurn(t normalize.LLMTurn) error {
	e.llmTurns = append(e.llmTurns, t)
	return nil
}
func (e *recordingEmitter) EmitSubagent(s normalize.Subagent) error {
	e.subagents = append(e.subagents, s)
	return nil
}
func (e *recordingEmitter) EmitEvent(ev normalize.EventEmission) error {
	e.events = append(e.events, ev)
	return nil
}
func (e *recordingEmitter) EmitGitCommit(c normalize.GitCommit) error {
	e.gitCommits = append(e.gitCommits, c)
	return nil
}
func (e *recordingEmitter) EmitGitPullRequest(p normalize.GitPullRequest) error {
	e.gitPRs = append(e.gitPRs, p)
	return nil
}

// withIsolatedCache redirects sessionstate's on-disk cache to a tmp
// dir so concurrent test runs don't pollute each other's state. We
// re-point both XDG_CACHE_HOME and HOME because os.UserCacheDir
// honours either depending on the platform.
func withIsolatedCache(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", dir)
	if home := os.Getenv("HOME"); home != "" {
		t.Setenv("HOME", dir)
	}
}

// input builds a normalize.Input the way the hook runner does.
// Returning a closure keeps the per-call boilerplate readable.
func inputBuilder(t *testing.T, em *recordingEmitter) func(event string, payload any) normalize.Input {
	t.Helper()
	return func(event string, payload any) normalize.Input {
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("payload marshal: %v", err)
		}
		return normalize.Input{
			Vendor:         "claude-code",
			Event:          event,
			Payload:        body,
			ContentCapture: "full",
			Emit:           em,
		}
	}
}

// TestClaudePreToolUseTaskLinksSubagent verifies the PreToolUse(Task)
// → SubagentStop linkage: the Task tool's `tool_use_id` is cached in
// sessionstate, then echoed on the EmitSubagent call as
// `ToolCallID`. The chat view groups by this id, so a regression
// here breaks the "expand subagent" UX.
func TestClaudePreToolUseTaskLinksSubagent(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	in := inputBuilder(t, em)
	sid := "cc-session-link-1"
	taskCallID := "toolu_01TASK"

	if err := handle(context.Background(), in("PreToolUse", map[string]any{
		"hook_event_name": "PreToolUse",
		"session_id":      sid,
		"tool_name":       "Task",
		"tool_use_id":     taskCallID,
		"tool_input":      json.RawMessage(`{"subagent_type":"research"}`),
	})); err != nil {
		t.Fatalf("PreToolUse(Task): %v", err)
	}

	st := sessionstate.Load(sid, "claude-code")
	if st == nil || st.ActiveTaskToolUseID != taskCallID {
		t.Fatalf("expected ActiveTaskToolUseID=%q after PreToolUse(Task); got %+v", taskCallID, st)
	}

	if err := handle(context.Background(), in("SubagentStop", map[string]any{
		"hook_event_name": "SubagentStop",
		"session_id":      sid,
		"subagent_type":   "research",
		"task_id":         "task-42",
	})); err != nil {
		t.Fatalf("SubagentStop: %v", err)
	}

	if len(em.subagents) != 1 {
		t.Fatalf("expected one subagent emission; got %d", len(em.subagents))
	}
	got := em.subagents[0]
	if got.ToolCallID != taskCallID {
		t.Errorf("subagent.ToolCallID = %q, want %q (the Task tool_use_id cached at PreToolUse)", got.ToolCallID, taskCallID)
	}
	if got.SubagentID != "task-42" {
		t.Errorf("subagent.SubagentID = %q, want %q", got.SubagentID, "task-42")
	}

	// Cache must be cleared after SubagentStop — otherwise a second
	// unrelated subagent in the same session would inherit the
	// stale id.
	st = sessionstate.Load(sid, "claude-code")
	if st != nil && st.ActiveTaskToolUseID != "" {
		t.Errorf("expected ActiveTaskToolUseID to be cleared post-SubagentStop; got %q", st.ActiveTaskToolUseID)
	}
}

// TestClaudeSubagentStopWithoutPreToolUse covers the resilient path:
// when sessionstate is missing (process restarted mid-session, or
// PreToolUse(Task) wasn't observed by this hook), SubagentStop still
// emits a span with the linkage fields it does have. The
// ToolCallID is empty — better than silently dropping the span.
func TestClaudeSubagentStopWithoutPreToolUse(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	in := inputBuilder(t, em)

	if err := handle(context.Background(), in("SubagentStop", map[string]any{
		"hook_event_name": "SubagentStop",
		"session_id":      "cc-orphan-1",
		"subagent_type":   "code-review",
		"task_id":         "task-x",
	})); err != nil {
		t.Fatalf("SubagentStop: %v", err)
	}
	if len(em.subagents) != 1 {
		t.Fatalf("expected one subagent emission; got %d", len(em.subagents))
	}
	if em.subagents[0].ToolCallID != "" {
		t.Errorf("expected empty ToolCallID when PreToolUse(Task) didn't cache one; got %q", em.subagents[0].ToolCallID)
	}
	if em.subagents[0].SubagentID != "task-x" {
		t.Errorf("subagent.SubagentID = %q, want %q", em.subagents[0].SubagentID, "task-x")
	}
}

// TestClaudeSessionDurationCachedAcrossInvocations verifies the
// W3.3 fix: SessionStart caches `SessionStartedAt` in sessionstate
// so that SessionEnd — which runs in a separate hook subprocess —
// can compute the real session duration instead of reporting 0ms.
//
// Without the cache, SessionEnd's `time.Now() - time.Now()` is
// always ~zero.
func TestClaudeSessionDurationCachedAcrossInvocations(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	in := inputBuilder(t, em)
	sid := "cc-duration-1"

	if err := handle(context.Background(), in("SessionStart", map[string]any{
		"hook_event_name": "SessionStart",
		"session_id":      sid,
		"cwd":             "/tmp/work",
		"source":          "startup",
	})); err != nil {
		t.Fatalf("SessionStart: %v", err)
	}

	// Rewind the cached start so SessionEnd sees a non-zero
	// duration even on the fastest CI runners. Using a real sleep
	// would slow this test down; mutating the cache directly is
	// the supported way to inject a known start time.
	st := sessionstate.Load(sid, "claude-code")
	if st == nil {
		t.Fatalf("expected sessionstate to be populated after SessionStart")
	}
	st.SessionStartedAt = time.Now().Add(-90 * time.Second)
	sessionstate.Save(sid, "claude-code", st)

	if err := handle(context.Background(), in("SessionEnd", map[string]any{
		"hook_event_name": "SessionEnd",
		"session_id":      sid,
		"cwd":             "/tmp/work",
		"reason":          "exit",
	})); err != nil {
		t.Fatalf("SessionEnd: %v", err)
	}

	// emitSession is called for both SessionStart and SessionEnd.
	// The ended one is whatever lands last with a non-zero EndedAt.
	var ended *normalize.Session
	for i := range em.sessions {
		s := em.sessions[i]
		if !s.EndedAt.IsZero() {
			ended = &em.sessions[i]
		}
	}
	if ended == nil {
		t.Fatalf("expected at least one ended session emission; got %d total", len(em.sessions))
	}
	if ended.StartedAt.IsZero() {
		t.Errorf("ended session.StartedAt is zero — duration cache regression")
	}
	if dur := ended.EndedAt.Sub(ended.StartedAt); dur < 30*time.Second {
		t.Errorf("ended session duration = %s, want >= 30s (cache should have rewound start)", dur)
	}
}
