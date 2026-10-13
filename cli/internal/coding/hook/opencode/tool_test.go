package opencode

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestToolExecuteEmitsOneCanonicalCallAfterCompletion(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	adapter := New()
	directory := t.TempDir()
	startedAt := time.Now().UTC().Add(-250 * time.Millisecond).Truncate(time.Millisecond)
	endedAt := startedAt.Add(200 * time.Millisecond)
	properties := map[string]any{
		"tool":      "bash",
		"sessionID": "ses_tool_full",
		"callID":    "call_42",
		"startedAt": startedAt.UnixMilli(),
		"args": map[string]any{
			"command": "echo full-secret-argument",
		},
	}
	before := map[string]any{
		"event": map[string]any{
			"type":       "tool.execute.before",
			"properties": properties,
		},
		"directory": directory,
		"worktree":  directory,
	}
	if err := adapter.Handle(context.Background(), adapterInput(t, em, "tool.execute.before", "full", before)); err != nil {
		t.Fatalf("tool.execute.before: %v", err)
	}
	if len(em.toolCalls) != 0 {
		t.Fatalf("tool.execute.before emitted %d tool calls, want 0", len(em.toolCalls))
	}
	if len(em.events) != 1 || em.events[0].Name != "coding_agent.tool.requested" {
		t.Fatalf("tool.execute.before event = %+v, want coding_agent.tool.requested", em.events)
	}
	if _, ok := em.events[0].Attrs["args"]; ok {
		t.Fatalf("tool request event leaked args: %+v", em.events[0].Attrs)
	}

	afterProperties := map[string]any{}
	for key, value := range properties {
		afterProperties[key] = value
	}
	afterProperties["title"] = "shell"
	afterProperties["output"] = "full-secret-result"
	afterProperties["metadata"] = map[string]any{"exit": 0}
	afterProperties["endedAt"] = endedAt.UnixMilli()
	after := map[string]any{
		"event": map[string]any{
			"type":       "tool.execute.after",
			"properties": afterProperties,
		},
		"directory": directory,
		"worktree":  directory,
	}
	if err := adapter.Handle(context.Background(), adapterInput(t, em, "tool.execute.after", "full", after)); err != nil {
		t.Fatalf("tool.execute.after: %v", err)
	}
	if len(em.toolCalls) != 1 {
		t.Fatalf("tool.execute.after emitted %d tool calls, want 1", len(em.toolCalls))
	}
	got := em.toolCalls[0]
	if got.SessionID != "ses_tool_full" || got.ToolName != "bash" || got.ToolUseID != "call_42" || got.Vendor != "opencode" {
		t.Errorf("tool identity = %+v", got)
	}
	if got.WorkingDir != directory {
		t.Errorf("tool working dir = %q, want %q", got.WorkingDir, directory)
	}
	if !got.StartedAt.Equal(startedAt) || !got.EndedAt.Equal(endedAt) || got.Duration != 200*time.Millisecond {
		t.Errorf("tool timing = %s/%s (%s), want %s/%s (200ms)", got.StartedAt, got.EndedAt, got.Duration, startedAt, endedAt)
	}
	if got.Errored {
		t.Error("successful tool call marked errored")
	}
	if !strings.Contains(got.Args, "full-secret-argument") || got.Result != "full-secret-result" {
		t.Errorf("full capture args/result = %q/%q", got.Args, got.Result)
	}
	if got.Command != "echo full-secret-argument" {
		t.Errorf("full capture command = %q, want full command", got.Command)
	}
}

func TestToolPartErrorEmitsOneBodyFreeFailedCall(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	startedAt := time.Now().UTC().Add(-500 * time.Millisecond).Truncate(time.Millisecond)
	endedAt := startedAt.Add(450 * time.Millisecond)
	payload := map[string]any{
		"event": map[string]any{
			"type": "tool.execute.error",
			"properties": map[string]any{
				"tool":      "bash",
				"sessionID": "ses_tool_error",
				"callID":    "call_failed",
				"status":    "error",
				"startedAt": startedAt.UnixMilli(),
				"endedAt":   endedAt.UnixMilli(),
				"args":      "must-not-be-forwarded",
				"output":    "must-not-be-forwarded",
				"error":     "must-not-be-forwarded",
			},
		},
		"directory": t.TempDir(),
	}
	input := adapterInput(t, em, "tool.execute.error", "full", payload)
	if err := New().Handle(context.Background(), input); err != nil {
		t.Fatalf("tool.execute.error: %v", err)
	}
	if err := New().Handle(context.Background(), input); err != nil {
		t.Fatalf("duplicate tool.execute.error: %v", err)
	}
	if len(em.toolCalls) != 1 {
		t.Fatalf("emitted %d failed calls, want exactly 1", len(em.toolCalls))
	}
	got := em.toolCalls[0]
	if !got.Errored || got.FailureType != "error" {
		t.Errorf("failed tool status = errored:%v failure:%q", got.Errored, got.FailureType)
	}
	if !got.StartedAt.Equal(startedAt) || !got.EndedAt.Equal(endedAt) || got.Duration != 450*time.Millisecond {
		t.Errorf("failed tool timing = %s/%s (%s)", got.StartedAt, got.EndedAt, got.Duration)
	}
	if got.Args != "" || got.Result != "" || got.ErrorMsg != "" {
		t.Errorf("safe failure projection leaked bodies: args=%q result=%q error=%q", got.Args, got.Result, got.ErrorMsg)
	}
}

func TestProviderExecutedToolPartEmitsOneBodyFreeSuccessfulCall(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	startedAt := time.Now().UTC().Add(-500 * time.Millisecond).Truncate(time.Millisecond)
	endedAt := startedAt.Add(450 * time.Millisecond)
	payload := map[string]any{
		"event": map[string]any{
			"type": "tool.execute.completed",
			"properties": map[string]any{
				"tool":      "websearch",
				"sessionID": "ses_provider_tool",
				"callID":    "call_provider",
				"status":    "completed",
				"startedAt": startedAt.UnixMilli(),
				"endedAt":   endedAt.UnixMilli(),
				"args":      "must-not-be-forwarded",
				"output":    "must-not-be-forwarded",
			},
		},
		"directory": t.TempDir(),
	}
	input := adapterInput(t, em, "tool.execute.completed", "full", payload)
	if err := New().Handle(context.Background(), input); err != nil {
		t.Fatalf("tool.execute.completed: %v", err)
	}
	if err := New().Handle(context.Background(), input); err != nil {
		t.Fatalf("duplicate tool.execute.completed: %v", err)
	}
	if len(em.toolCalls) != 1 {
		t.Fatalf("emitted %d provider tool calls, want exactly 1", len(em.toolCalls))
	}
	got := em.toolCalls[0]
	if got.Errored || got.FailureType != "" {
		t.Errorf("provider tool status = errored:%v failure:%q", got.Errored, got.FailureType)
	}
	if got.ToolName != "websearch" || got.ToolUseID != "call_provider" {
		t.Errorf("provider tool identity = %+v", got)
	}
	if !got.StartedAt.Equal(startedAt) || !got.EndedAt.Equal(endedAt) || got.Duration != 450*time.Millisecond {
		t.Errorf("provider tool timing = %s/%s (%s)", got.StartedAt, got.EndedAt, got.Duration)
	}
	if got.Args != "" || got.Result != "" || got.ErrorMsg != "" {
		t.Errorf("safe provider projection leaked bodies: args=%q result=%q error=%q", got.Args, got.Result, got.ErrorMsg)
	}
}

func TestToolExecuteCaptureModesDoNotLeakBodies(t *testing.T) {
	for _, capture := range []string{"metadata_only", "minimal"} {
		t.Run(capture, func(t *testing.T) {
			withIsolatedCache(t)
			em := &recordingEmitter{}
			payload := map[string]any{
				"event": map[string]any{
					"type": "tool.execute.after",
					"properties": map[string]any{
						"tool":      "bash",
						"sessionID": "ses_tool_" + capture,
						"callID":    "call_private",
						"args": map[string]any{
							"command": "echo non-full-secret-argument",
						},
						"output":   "non-full-secret-result",
						"metadata": map[string]any{"error": "non-full-secret-error"},
					},
				},
				"directory": t.TempDir(),
			}
			if err := New().Handle(context.Background(), adapterInput(t, em, "tool.execute.after", capture, payload)); err != nil {
				t.Fatalf("tool.execute.after: %v", err)
			}
			if len(em.toolCalls) != 1 {
				t.Fatalf("emitted %d tool calls, want 1", len(em.toolCalls))
			}
			got := em.toolCalls[0]
			if got.Args != "" || got.Result != "" || got.ErrorMsg != "" {
				t.Errorf("%s leaked bodies: args=%q result=%q error=%q", capture, got.Args, got.Result, got.ErrorMsg)
			}
			if got.Command != "echo" {
				t.Errorf("%s command = %q, want executable-only metadata", capture, got.Command)
			}
		})
	}
}
