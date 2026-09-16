package opencode

import (
	"context"
	"testing"
)

func TestBodyBearingMessageEventsAreIgnored(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	adapter := New()
	payloads := []struct {
		event   string
		payload map[string]any
	}{
		{
			event: "chat.message",
			payload: map[string]any{
				"event": map[string]any{
					"type": "chat.message",
					"properties": map[string]any{
						"sessionID": "ses_private",
						"parts": []map[string]any{{
							"type": "text",
							"text": "chat-message-secret",
						}},
					},
				},
			},
		},
		{
			event: "message.part.updated",
			payload: map[string]any{
				"event": map[string]any{
					"type": "message.part.updated",
					"properties": map[string]any{
						"part": map[string]any{
							"sessionID": "ses_private",
							"type":      "reasoning",
							"text":      "reasoning-part-secret",
						},
						"delta": "reasoning-delta-secret",
					},
				},
			},
		},
	}
	for _, test := range payloads {
		if err := adapter.Handle(context.Background(), adapterInput(t, em, test.event, "full", test.payload)); err != nil {
			t.Fatalf("%s: %v", test.event, err)
		}
	}
	if len(em.llmTurns) != 0 || len(em.events) != 0 || len(em.toolCalls) != 0 || len(em.sessions) != 0 {
		t.Fatalf("body-bearing events emitted telemetry: turns=%d events=%d tools=%d sessions=%d",
			len(em.llmTurns), len(em.events), len(em.toolCalls), len(em.sessions))
	}
}
