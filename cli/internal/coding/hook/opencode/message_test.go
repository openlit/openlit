package opencode

import (
	"context"
	"testing"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/sdk/go/semconv"
)

func TestMessageUpdatedEmitsMetadataWithoutBodies(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	adapter := New()
	createdAt := time.Now().UTC().Add(-time.Second).Truncate(time.Millisecond)
	userMessage := map[string]any{
		"event": map[string]any{
			"type": "message.updated",
			"properties": map[string]any{
				"info": map[string]any{
					"id":        "msg_user_1",
					"sessionID": "ses_messages",
					"role":      "user",
					"time": map[string]any{
						"created": createdAt.UnixMilli(),
					},
					"model": map[string]any{
						"providerID": "anthropic",
						"modelID":    "claude-sonnet-4-5",
					},
					"content":   "prompt-secret-must-not-leak",
					"text":      "prompt-secret-must-not-leak",
					"reasoning": "reasoning-secret-must-not-leak",
				},
			},
		},
	}
	if err := adapter.Handle(context.Background(), adapterInput(t, em, "message.updated", "full", userMessage)); err != nil {
		t.Fatalf("user message.updated: %v", err)
	}
	if len(em.llmTurns) != 0 {
		t.Fatalf("metadata-only user update emitted %d LLM turns, want 0", len(em.llmTurns))
	}

	completedAt := createdAt.Add(750 * time.Millisecond)
	assistantMessage := map[string]any{
		"event": map[string]any{
			"type": "message.updated",
			"properties": map[string]any{
				"info": map[string]any{
					"id":         "msg_assistant_1",
					"sessionID":  "ses_messages",
					"role":       "assistant",
					"modelID":    "claude-sonnet-4-5",
					"providerID": "anthropic",
					"mode":       "plan",
					"time": map[string]any{
						"created":   createdAt.UnixMilli(),
						"completed": completedAt.UnixMilli(),
					},
					"cost": 0.0125,
					"tokens": map[string]any{
						"input":     100,
						"output":    20,
						"reasoning": 5,
						"cache": map[string]any{
							"read":  40,
							"write": 10,
						},
					},
					"finish":    "stop",
					"content":   "assistant-secret-must-not-leak",
					"text":      "assistant-secret-must-not-leak",
					"reasoning": "reasoning-secret-must-not-leak",
				},
			},
		},
	}
	if err := adapter.Handle(context.Background(), adapterInput(t, em, "message.updated", "full", assistantMessage)); err != nil {
		t.Fatalf("assistant message.updated: %v", err)
	}
	if len(em.llmTurns) != 1 {
		t.Fatalf("assistant message brought total to %d LLM turns, want 1", len(em.llmTurns))
	}
	assistantTurn := em.llmTurns[0]
	if !assistantTurn.AssistantMessageOnly {
		t.Error("assistant message turn is not marked AssistantMessageOnly")
	}
	if assistantTurn.InputTokens != 100 || assistantTurn.OutputTokens != 20 || assistantTurn.TotalTokens != 175 {
		t.Errorf("assistant token totals = %d/%d/%d, want 100/20/175", assistantTurn.InputTokens, assistantTurn.OutputTokens, assistantTurn.TotalTokens)
	}
	if assistantTurn.ReasoningTokens != 5 {
		t.Errorf("assistant reasoning tokens = %d, want 5", assistantTurn.ReasoningTokens)
	}
	if assistantTurn.CacheReadTokens != 40 || assistantTurn.CacheCreationTokens != 10 {
		t.Errorf("assistant cache tokens = %d/%d, want 40/10", assistantTurn.CacheReadTokens, assistantTurn.CacheCreationTokens)
	}
	if assistantTurn.CostUSD != 0.0125 {
		t.Errorf("assistant cost = %v, want 0.0125", assistantTurn.CostUSD)
	}
	if len(assistantTurn.FinishReasons) != 1 || assistantTurn.FinishReasons[0] != "stop" {
		t.Errorf("assistant finish reasons = %v, want [stop]", assistantTurn.FinishReasons)
	}
	if _, ok := assistantTurn.Extras[semconv.CodingAgentLLMTurnKind]; ok {
		t.Error("assistant turn kind bypassed the canonical emitter mapping")
	}
	assertNoMessageBodies(t, assistantTurn)

	if err := adapter.Handle(context.Background(), adapterInput(t, em, "message.updated", "full", assistantMessage)); err != nil {
		t.Fatalf("duplicate assistant message.updated: %v", err)
	}
	if len(em.llmTurns) != 1 {
		t.Fatalf("duplicate completed assistant emitted %d total turns, want 1", len(em.llmTurns))
	}
}

func assertNoMessageBodies(t *testing.T, turn normalize.LLMTurn) {
	t.Helper()
	if turn.Prompt != "" || turn.Response != "" || turn.ThoughtText != "" {
		t.Errorf("message body leaked: prompt=%q response=%q thought=%q", turn.Prompt, turn.Response, turn.ThoughtText)
	}
}
