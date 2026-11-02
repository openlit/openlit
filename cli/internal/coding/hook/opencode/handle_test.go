package opencode

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/sdk/go/semconv"
)

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

func (e *recordingEmitter) EmitToolCall(tc normalize.ToolCall) error {
	e.toolCalls = append(e.toolCalls, tc)
	return nil
}

func (e *recordingEmitter) EmitEditDecision(d normalize.EditDecision) error {
	e.editDecisions = append(e.editDecisions, d)
	return nil
}

func (e *recordingEmitter) EmitLLMTurn(turn normalize.LLMTurn) error {
	e.llmTurns = append(e.llmTurns, turn)
	return nil
}

func (e *recordingEmitter) EmitSubagent(s normalize.Subagent) error {
	e.subagents = append(e.subagents, s)
	return nil
}

func (e *recordingEmitter) EmitEvent(event normalize.EventEmission) error {
	e.events = append(e.events, event)
	return nil
}

func (e *recordingEmitter) EmitGitCommit(commit normalize.GitCommit) error {
	e.gitCommits = append(e.gitCommits, commit)
	return nil
}

func (e *recordingEmitter) EmitGitPullRequest(pr normalize.GitPullRequest) error {
	e.gitPRs = append(e.gitPRs, pr)
	return nil
}

func withIsolatedCache(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", dir)
	t.Setenv("LOCALAPPDATA", dir)
	if os.Getenv("HOME") != "" {
		t.Setenv("HOME", dir)
	}
}

func adapterInput(t *testing.T, em normalize.Emitter, event, capture string, payload any) normalize.Input {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return normalize.Input{
		Vendor:         "opencode",
		Event:          event,
		Payload:        body,
		ContentCapture: capture,
		Emit:           em,
	}
}

func TestUnknownEventIsDropped(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	payload := map[string]any{
		"event": map[string]any{
			"type": "plugin.future.event",
			"properties": map[string]any{
				"opaque": "value",
			},
		},
	}
	if err := New().Handle(context.Background(), adapterInput(t, em, "plugin.future.event", "full", payload)); err != nil {
		t.Fatalf("unknown event: %v", err)
	}
	if len(em.sessions)+len(em.toolCalls)+len(em.editDecisions)+len(em.llmTurns)+len(em.subagents)+len(em.events)+len(em.gitCommits)+len(em.gitPRs) != 0 {
		t.Fatalf("unknown event emitted telemetry: %+v", em)
	}
}

func TestLifecycleDoesNotTreatIdleAsSessionEnd(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	adapter := New()
	startedAt := time.Now().UTC().Add(-5 * time.Minute).Truncate(time.Millisecond)
	directory := t.TempDir()
	created := map[string]any{
		"event": map[string]any{
			"type": "session.created",
			"properties": map[string]any{
				"info": map[string]any{
					"id":        "ses_open_1",
					"directory": directory,
					"parentID":  "ses_parent",
					"title":     "private session title",
					"version":   "1.18.16",
					"time": map[string]any{
						"created": startedAt.UnixMilli(),
					},
				},
			},
		},
		"directory": directory,
		"worktree":  directory,
	}
	if err := adapter.Handle(context.Background(), adapterInput(t, em, "session.created", "metadata_only", created)); err != nil {
		t.Fatalf("session.created: %v", err)
	}
	if len(em.sessions) != 0 {
		t.Fatalf("session.created emitted %d session roots, want 0", len(em.sessions))
	}
	if len(em.events) != 1 || em.events[0].Name != semconv.CodingAgentEventSessionStart {
		t.Fatalf("session.created event = %+v, want %q", em.events, semconv.CodingAgentEventSessionStart)
	}

	idle := map[string]any{
		"event": map[string]any{
			"type": "session.idle",
			"properties": map[string]any{
				"sessionID": "ses_open_1",
			},
		},
		"directory": directory,
		"worktree":  directory,
	}
	if err := adapter.Handle(context.Background(), adapterInput(t, em, "session.idle", "metadata_only", idle)); err != nil {
		t.Fatalf("first session.idle: %v", err)
	}
	if len(em.sessions) != 0 {
		t.Fatalf("session.idle emitted %d roots, want 0 because idle is a turn boundary", len(em.sessions))
	}
	if len(em.events) != 2 || em.events[1].Name != "coding_agent.session.loop.stop" {
		t.Fatalf("session.idle events = %+v, want loop.stop after session.start", em.events)
	}
	if _, ok := em.events[1].Attrs[semconv.CodingAgentSessionOutcome]; ok {
		t.Fatalf("session.idle fabricated a terminal outcome: %+v", em.events[1].Attrs)
	}

	if err := adapter.Handle(context.Background(), adapterInput(t, em, "session.idle", "metadata_only", idle)); err != nil {
		t.Fatalf("duplicate session.idle: %v", err)
	}
	if len(em.sessions) != 0 {
		t.Fatalf("later session.idle emitted %d roots, want 0", len(em.sessions))
	}
}
