package cursor

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
)

// recordingEmitter mirrors the same shape used by codex / claudecode
// adapter tests. Kept local on purpose — see the comment in
// claudecode/handle_test.go for the rationale.
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

// withIsolatedCache redirects sessionstate to a temp dir.
func withIsolatedCache(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", dir)
	if home := os.Getenv("HOME"); home != "" {
		t.Setenv("HOME", dir)
	}
}

func inputBuilder(t *testing.T, em *recordingEmitter) func(event string, payload any) normalize.Input {
	t.Helper()
	return func(event string, payload any) normalize.Input {
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("payload marshal: %v", err)
		}
		return normalize.Input{
			Vendor:         "cursor",
			Event:          event,
			Payload:        body,
			ContentCapture: "full",
			Emit:           em,
		}
	}
}

// TestCursorSubagentStopReStampsLinkage covers W2.1 — every linkage
// attribute (SubagentID, ParentConversationID, ToolCallID, Model,
// GitBranch, IsParallelWorker) must be present on both
// subagentStart AND subagentStop. The earlier implementation dropped
// these on Stop, which broke the trace-view join between subagent
// start / stop spans and the spawning Task tool call.
func TestCursorSubagentStopReStampsLinkage(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	in := inputBuilder(t, em)

	stopPayload := map[string]any{
		"hook_event_name":        "subagentStop",
		"conversation_id":        "cur-chat-1",
		"subagent_id":            "sub-42",
		"parent_conversation_id": "cur-chat-1",
		"subagent_type":          "edit",
		"task":                   "refactor",
		"tool_call_id":           "tc-99",
		"subagent_model":         "claude-3.5-sonnet",
		"git_branch":             "feat/sub",
		"is_parallel_worker":     true,
		"duration_ms":            int64(2400),
		"message_count":          5,
		"tool_call_count":        3,
		"modified_files":         []string{"a.go", "b.go"},
		"status":                 "completed",
	}
	if err := handle(context.Background(), in("subagentStop", stopPayload)); err != nil {
		t.Fatalf("subagentStop: %v", err)
	}
	if len(em.subagents) != 1 {
		t.Fatalf("expected one subagent emission; got %d", len(em.subagents))
	}
	got := em.subagents[0]

	checks := []struct {
		name string
		want any
		got  any
	}{
		{"SubagentID", "sub-42", got.SubagentID},
		{"ParentConversationID", "cur-chat-1", got.ParentConversationID},
		{"ToolCallID", "tc-99", got.ToolCallID},
		{"Model", "claude-3.5-sonnet", got.Model},
		{"GitBranch", "feat/sub", got.GitBranch},
		{"IsParallelWorker", true, got.IsParallelWorker},
		{"DurationMs", int64(2400), got.DurationMs},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("subagentStop %s = %v, want %v", c.name, c.got, c.want)
		}
	}
	if got.Status != "completed" {
		t.Errorf("subagentStop Status = %q, want %q", got.Status, "completed")
	}
	if len(got.ModifiedFiles) != 2 {
		t.Errorf("subagentStop ModifiedFiles len = %d, want 2", len(got.ModifiedFiles))
	}
}

// TestCursorSubagentStartLinkage is the matching positive case for
// subagentStart. We assert the same fields land on the Start span
// so the chat view's start ↔ stop pair both carry the linkage.
func TestCursorSubagentStartLinkage(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	in := inputBuilder(t, em)

	startPayload := map[string]any{
		"hook_event_name":        "subagentStart",
		"conversation_id":        "cur-chat-2",
		"subagent_id":            "sub-7",
		"parent_conversation_id": "cur-chat-2",
		"subagent_type":          "research",
		"task":                   "explore types",
		"tool_call_id":           "tc-7",
		"subagent_model":         "gpt-5",
		"git_branch":             "feat/types",
		"is_parallel_worker":     false,
	}
	if err := handle(context.Background(), in("subagentStart", startPayload)); err != nil {
		t.Fatalf("subagentStart: %v", err)
	}
	if len(em.subagents) != 1 {
		t.Fatalf("expected one subagent emission; got %d", len(em.subagents))
	}
	got := em.subagents[0]
	if got.SubagentID != "sub-7" || got.ToolCallID != "tc-7" || got.ParentConversationID != "cur-chat-2" {
		t.Errorf("subagentStart linkage = %+v, want sub-7/tc-7/cur-chat-2", got)
	}
	if got.Status != "started" {
		t.Errorf("subagentStart Status = %q, want %q", got.Status, "started")
	}
}

// TestCursorSessionIDPrefersConversation covers the chat-thread key
// resolution: when both conversation_id and session_id are present,
// the adapter must use conversation_id (stable across Cursor
// restarts and subagent spawns). session_id is a per-process fallback
// only.
func TestCursorSessionIDPrefersConversation(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	in := inputBuilder(t, em)

	if err := handle(context.Background(), in("sessionStart", map[string]any{
		"hook_event_name": "sessionStart",
		"conversation_id": "convo-stable",
		"session_id":      "proc-tmp",
		"cwd":             "/tmp",
		"model":           "claude-3.5-sonnet",
	})); err != nil {
		t.Fatalf("sessionStart: %v", err)
	}
	if len(em.sessions) != 1 {
		t.Fatalf("expected one session emission; got %d", len(em.sessions))
	}
	if em.sessions[0].SessionID != "convo-stable" {
		t.Errorf("session.SessionID = %q, want %q (conversation_id must win over session_id)",
			em.sessions[0].SessionID, "convo-stable")
	}
}
