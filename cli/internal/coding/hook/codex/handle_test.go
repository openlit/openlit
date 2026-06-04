package codex

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/coding/sessionstate"
)

// recordingEmitter is a normalize.Emitter implementation that captures
// every call so tests can assert on the order + content of emissions.
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
// dir so tests don't leak state between runs.
func withIsolatedCache(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", dir)
	if home := os.Getenv("HOME"); home != "" {
		t.Setenv("HOME", dir)
	}
}

func TestCodexEndToEndOneTurn(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	in := func(event string, payload any) normalize.Input {
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("payload marshal: %v", err)
		}
		return normalize.Input{
			Vendor:         "codex",
			Event:          event,
			Payload:        body,
			ContentCapture: "full",
			Emit:           em,
		}
	}

	sid := "cdx-session-1"
	turn := "turn-1"
	now := time.Now().UTC().Format(time.RFC3339Nano)

	if err := handle(context.Background(), in("SessionStart", map[string]any{
		"hook_event_name": "SessionStart",
		"session_id":      sid,
		"cwd":             "/tmp/work",
		"model":           "gpt-5",
		"source":          "startup",
		"timestamp":       now,
	})); err != nil {
		t.Fatalf("SessionStart: %v", err)
	}
	if err := handle(context.Background(), in("UserPromptSubmit", map[string]any{
		"hook_event_name": "UserPromptSubmit",
		"session_id":      sid,
		"turn_id":         turn,
		"prompt":          "refactor sessionstate",
		"timestamp":       now,
	})); err != nil {
		t.Fatalf("UserPromptSubmit: %v", err)
	}
	if err := handle(context.Background(), in("PostToolUse", map[string]any{
		"hook_event_name":  "PostToolUse",
		"session_id":       sid,
		"turn_id":          turn,
		"tool_name":        "shell",
		"tool_use_id":      "call_1",
		"tool_input":       json.RawMessage(`{"command":"ls -la"}`),
		"tool_response":    json.RawMessage(`{"stdout":"foo bar","exit_code":0}`),
		"tool_duration_ms": 25.0,
		"status":           "completed",
		"timestamp":        now,
	})); err != nil {
		t.Fatalf("PostToolUse: %v", err)
	}
	lastMsg := "Refactored, see diff."
	if err := handle(context.Background(), in("Stop", map[string]any{
		"hook_event_name":        "Stop",
		"session_id":             sid,
		"turn_id":                turn,
		"last_assistant_message": lastMsg,
		"timestamp":              now,
	})); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	// Sessions: SessionStart → 1, Stop → 1 (Codex has no SessionEnd
	// event, so we re-emit the session-root span on every Stop with
	// outcome=completed). The deterministic span IDs in the otlp
	// emitter dedupe these into a single `otel_traces` row.
	if len(em.sessions) != 2 {
		t.Fatalf("expected 2 sessions (start + stop), got %d", len(em.sessions))
	}
	if em.sessions[0].Vendor != "codex" {
		t.Errorf("session vendor: got %q, want codex", em.sessions[0].Vendor)
	}
	if em.sessions[1].Outcome == "" {
		t.Errorf("stop session outcome empty; expected `completed`")
	}
	// Tool calls: PostToolUse → 1
	if len(em.toolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(em.toolCalls))
	}
	tc := em.toolCalls[0]
	if tc.ToolName != "shell" {
		t.Errorf("tool name: got %q, want shell", tc.ToolName)
	}
	if tc.Command != "ls -la" {
		t.Errorf("tool command (full mode): got %q, want %q", tc.Command, "ls -la")
	}
	// LLM turns: Stop → 1
	if len(em.llmTurns) != 1 {
		t.Fatalf("expected 1 llm turn, got %d", len(em.llmTurns))
	}
	llt := em.llmTurns[0]
	if llt.Prompt != "refactor sessionstate" {
		t.Errorf("llm.prompt: got %q", llt.Prompt)
	}
	if llt.Response != lastMsg {
		t.Errorf("llm.response: got %q want %q", llt.Response, lastMsg)
	}
	// Tool calls + tool results are NOT folded onto the LLM-turn
	// span — they live on the dedicated `coding_agent.tool.call`
	// span (asserted above via em.toolCalls). Re-encoding them in
	// the turn's messages JSON used to balloon `gen_ai.input.messages`
	// past the 16 KB cap, which broke the chat view's JSON parser.
}

// TestCodexMetadataModeDropsBodies verifies the content-capture matrix:
// in metadata mode we still emit the LLM turn span but bodies are gone.
func TestCodexMetadataModeDropsBodies(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	in := func(event string, payload any) normalize.Input {
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("payload marshal: %v", err)
		}
		return normalize.Input{
			Vendor:         "codex",
			Event:          event,
			Payload:        body,
			ContentCapture: "metadata_only",
			Emit:           em,
		}
	}

	sid := "cdx-session-2"
	turn := "turn-A"

	if err := handle(context.Background(), in("UserPromptSubmit", map[string]any{
		"session_id": sid,
		"turn_id":    turn,
		"prompt":     "this should not appear",
	})); err != nil {
		t.Fatalf("UserPromptSubmit: %v", err)
	}
	lastMsg := "and neither should this"
	if err := handle(context.Background(), in("Stop", map[string]any{
		"session_id":             sid,
		"turn_id":                turn,
		"last_assistant_message": lastMsg,
	})); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if len(em.llmTurns) != 1 {
		t.Fatalf("expected 1 llm turn, got %d", len(em.llmTurns))
	}
	if em.llmTurns[0].Prompt != "" {
		t.Errorf("metadata mode leaked prompt body: %q", em.llmTurns[0].Prompt)
	}
	if em.llmTurns[0].Response != "" {
		t.Errorf("metadata mode leaked response body: %q", em.llmTurns[0].Response)
	}
}

// TestCodexTokenSnapshotFromRollout verifies that the per-turn token
// delta is computed correctly from a synthetic rollout.jsonl. This is
// the contract that downstream USD cost rollups depend on.
func TestCodexTokenSnapshotFromRollout(t *testing.T) {
	dir := t.TempDir()
	rollout := filepath.Join(dir, "rollout-2026-05-test.jsonl")

	lines := []map[string]any{
		{"type": "session_meta", "payload": map[string]any{"id": "cdx-tok-1"}},
		// turn A starts — baseline = 0 input/0 output (first turn)
		{"type": "turn_context", "payload": map[string]any{"turn_id": "turn-A"}},
		// pre-model snapshot
		{"type": "event_msg", "payload": map[string]any{
			"type": "token_count",
			"info": map[string]any{
				"total_token_usage":    map[string]any{"input_tokens": 100, "output_tokens": 0, "total_tokens": 100},
				"model_context_window": 200000,
			},
		}},
		// model activity → next token_count is final for this turn
		{"type": "response_item", "payload": map[string]any{"type": "message", "role": "assistant"}},
		{"type": "event_msg", "payload": map[string]any{
			"type": "token_count",
			"info": map[string]any{
				"total_token_usage": map[string]any{"input_tokens": 1500, "output_tokens": 400, "cached_input_tokens": 800, "reasoning_output_tokens": 150, "total_tokens": 1900},
			},
		}},
	}
	var buf []byte
	for _, l := range lines {
		b, err := json.Marshal(l)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		buf = append(buf, b...)
		buf = append(buf, '\n')
	}
	if err := os.WriteFile(rollout, buf, 0o600); err != nil {
		t.Fatalf("write rollout: %v", err)
	}
	snap, ok := readTokenUsageForTurn(rollout, "turn-A")
	if !ok {
		t.Fatalf("expected token snapshot, got none")
	}
	// Per-turn delta = final cumulative - pre-model baseline. The
	// pre-model snapshot was 100 input / 0 output, so the delta we
	// attribute to this turn's model activity is 1400 / 400 /
	// 800-cached / 150-reasoning. Crucially the BASELINE (100
	// cumulative input before the turn started thinking) belongs to
	// system/dialog overhead, not this turn.
	if snap.TurnUsage.InputTokens != 1400 {
		t.Errorf("input_tokens: got %d want 1400", snap.TurnUsage.InputTokens)
	}
	if snap.TurnUsage.OutputTokens != 400 {
		t.Errorf("output_tokens: got %d want 400", snap.TurnUsage.OutputTokens)
	}
	if snap.TurnUsage.CachedInputTokens != 800 {
		t.Errorf("cached_input_tokens: got %d want 800", snap.TurnUsage.CachedInputTokens)
	}
	if snap.TurnUsage.ReasoningOutputTokens != 150 {
		t.Errorf("reasoning_output_tokens: got %d want 150", snap.TurnUsage.ReasoningOutputTokens)
	}
	if snap.TotalUsage.InputTokens != 1500 {
		t.Errorf("total cumulative input: got %d want 1500", snap.TotalUsage.InputTokens)
	}
}

// TestCodexSubagentLinkFromSessionMeta verifies that a `session_meta`
// block with subagent fields is cached into sessionstate so subsequent
// spans inherit `coding_agent.agent.parent_id`.
func TestCodexSubagentLinkFromSessionMeta(t *testing.T) {
	withIsolatedCache(t)

	dir := t.TempDir()
	rollout := filepath.Join(dir, "rollout-2026-05-sub.jsonl")
	body := map[string]any{
		"type": "session_meta",
		"payload": map[string]any{
			"id":                "cdx-child",
			"thread_source":     "subagent",
			"parent_session_id": "cdx-parent",
			"agent_role":        "code-reviewer",
			"agent_nickname":    "reviewer-1",
			"agent_depth":       2,
		},
	}
	raw, _ := json.Marshal(body)
	if err := os.WriteFile(rollout, append(raw, '\n'), 0o600); err != nil {
		t.Fatalf("write rollout: %v", err)
	}
	em := &recordingEmitter{}
	body2, _ := json.Marshal(map[string]any{
		"hook_event_name": "SessionStart",
		"session_id":      "cdx-child",
		"transcript_path": rollout,
		"timestamp":       time.Now().UTC().Format(time.RFC3339Nano),
		"cwd":             "/tmp",
	})
	if err := handle(context.Background(), normalize.Input{
		Vendor:         "codex",
		Event:          "SessionStart",
		Payload:        body2,
		ContentCapture: "metadata_only",
		Emit:           em,
	}); err != nil {
		t.Fatalf("SessionStart: %v", err)
	}
	st := sessionstate.Load("cdx-child", "codex")
	if st == nil || st.CodexSubagent == nil {
		t.Fatalf("expected subagent link, got %+v", st)
	}
	if st.CodexSubagent.ParentSessionID != "cdx-parent" {
		t.Errorf("parent_session_id: got %q want cdx-parent", st.CodexSubagent.ParentSessionID)
	}
	if st.CodexSubagent.AgentRole != "code-reviewer" {
		t.Errorf("agent_role: got %q", st.CodexSubagent.AgentRole)
	}

	// The session-root span emitted on SessionStart must carry the
	// parent linkage. Without this, the Sessions list shows the
	// subagent as a standalone row instead of folding it under the
	// parent's chat.
	if len(em.sessions) == 0 {
		t.Fatalf("expected SessionStart to emit a session span")
	}
	gotParent := em.sessions[0].Extras["coding_agent.agent.parent_id"]
	if gotParent != "cdx-parent" {
		t.Errorf("SessionStart extras parent_id: got %q want cdx-parent", gotParent)
	}

	// A later Stop event in the same subagent session must re-stamp
	// the parent_id on the llm.turn span — long subagents accumulate
	// many turns and the UI's chat_id fold relies on the resource
	// attr being present on *every* span this session emits, not just
	// the root.
	turn := "turn-sub-1"
	stopBody, _ := json.Marshal(map[string]any{
		"hook_event_name":        "Stop",
		"session_id":             "cdx-child",
		"turn_id":                turn,
		"transcript_path":        rollout,
		"last_assistant_message": "ok",
		"timestamp":              time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err := handle(context.Background(), normalize.Input{
		Vendor:         "codex",
		Event:          "Stop",
		Payload:        stopBody,
		ContentCapture: "full",
		Emit:           em,
	}); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if len(em.llmTurns) == 0 {
		t.Fatalf("expected Stop to emit an llm.turn")
	}
	turnParent := em.llmTurns[0].Extras["coding_agent.agent.parent_id"]
	if turnParent != "cdx-parent" {
		t.Errorf("llm.turn extras parent_id: got %q want cdx-parent", turnParent)
	}
}
