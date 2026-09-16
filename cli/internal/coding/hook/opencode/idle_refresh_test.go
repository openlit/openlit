package opencode

import (
	"context"
	"math"
	"testing"

	"github.com/openlit/openlit/cli/internal/coding/sessionstate"
	"github.com/openlit/openlit/sdk/go/semconv"
)

func TestSessionErrorAndFollowingIdleDoNotReportCompletion(t *testing.T) {
	withIsolatedCache(t)

	em := &recordingEmitter{}
	errorPayload := map[string]any{
		"event": map[string]any{
			"type": "session.error",
			"properties": map[string]any{
				"sessionID": "ses_failed",
				"errorName": "APIError",
				"message":   "must-not-be-recorded",
			},
		},
	}
	if err := New().Handle(context.Background(), adapterInput(t, em, "session.error", "full", errorPayload)); err != nil {
		t.Fatalf("session.error: %v", err)
	}
	if len(em.events) != 1 || em.events[0].Name != "coding_agent.session.error" {
		t.Fatalf("session.error events = %+v", em.events)
	}
	if em.events[0].Attrs[semconv.ErrorType] != "APIError" {
		t.Errorf("error type = %v, want APIError", em.events[0].Attrs[semconv.ErrorType])
	}
	for _, value := range em.events[0].Attrs {
		if value == "must-not-be-recorded" {
			t.Fatalf("session.error leaked error body: %+v", em.events[0].Attrs)
		}
	}

	idlePayload := map[string]any{
		"event": map[string]any{
			"type":       "session.idle",
			"properties": map[string]any{"sessionID": "ses_failed"},
		},
	}
	if err := New().Handle(context.Background(), adapterInput(t, em, "session.idle", "full", idlePayload)); err != nil {
		t.Fatalf("session.idle: %v", err)
	}
	if len(em.sessions) != 0 {
		t.Fatalf("error + idle emitted %d terminal roots, want 0", len(em.sessions))
	}
	if _, ok := em.events[len(em.events)-1].Attrs[semconv.CodingAgentSessionOutcome]; ok {
		t.Fatalf("idle after error reported terminal outcome: %+v", em.events[len(em.events)-1].Attrs)
	}
}

func TestMinimalIdleEmitsCounterSnapshotWithoutTerminalOutcome(t *testing.T) {
	withIsolatedCache(t)

	const sessionID = "ses_minimal_snapshot"
	state := &sessionstate.State{
		ConversationID: sessionID,
		ToolCallCount:  2,
		InputTokens:    100,
		OutputTokens:   25,
		TotalTokens:    140,
		CostUSD:        0.01,
	}
	sessionstate.Save(sessionID, "opencode", state)
	em := &recordingEmitter{}
	payload := map[string]any{
		"event": map[string]any{
			"type":       "session.idle",
			"properties": map[string]any{"sessionID": sessionID},
		},
	}
	input := adapterInput(t, em, "session.idle", "minimal", payload)
	if err := New().Handle(context.Background(), input); err != nil {
		t.Fatalf("first minimal session.idle: %v", err)
	}
	if len(em.events) != 1 || em.events[0].Name != semconv.CodingAgentEventSessionSnapshot {
		t.Fatalf("minimal idle events = %+v, want one session.snapshot", em.events)
	}
	first := em.events[0].Attrs
	if first[semconv.CodingAgentSessionToolCallCount] != 2 || first[semconv.GenAIUsageInputTokens] != int64(100) || first[semconv.GenAIUsageOutputTokens] != int64(25) || first[semconv.GenAIUsageTotalTokens] != int64(140) {
		t.Errorf("first snapshot counters = %+v", first)
	}
	if first[semconv.GenAIUsageCost] != 0.01 {
		t.Errorf("first snapshot cost = %v, want 0.01", first[semconv.GenAIUsageCost])
	}
	if _, ok := first[semconv.CodingAgentSessionOutcome]; ok {
		t.Fatalf("minimal snapshot fabricated terminal outcome: %+v", first)
	}

	state = sessionstate.Load(sessionID, "opencode")
	state.ToolCallCount = 3
	state.InputTokens = 140
	state.OutputTokens = 35
	state.TotalTokens = 195
	state.CostUSD = 0.015
	sessionstate.Save(sessionID, "opencode", state)
	if err := New().Handle(context.Background(), input); err != nil {
		t.Fatalf("second minimal session.idle: %v", err)
	}
	second := em.events[1].Attrs
	if second[semconv.CodingAgentSessionToolCallCount] != 3 || second[semconv.GenAIUsageInputTokens] != int64(40) || second[semconv.GenAIUsageOutputTokens] != int64(10) || second[semconv.GenAIUsageTotalTokens] != int64(55) {
		t.Errorf("second snapshot counters = %+v", second)
	}
	if got, _ := second[semconv.GenAIUsageCost].(float64); math.Abs(got-0.005) > 1e-9 {
		t.Errorf("second snapshot cost = %v, want delta 0.005", second[semconv.GenAIUsageCost])
	}
}

func TestMinimalErrorEmitsImmediateSnapshotAndFollowingIdleDoesNotRepeatIt(t *testing.T) {
	withIsolatedCache(t)

	const sessionID = "ses_minimal_error"
	em := &recordingEmitter{}
	errorPayload := map[string]any{
		"event": map[string]any{
			"type": "session.error",
			"properties": map[string]any{
				"sessionID": sessionID,
				"errorName": "APIError",
				"message":   "must-not-be-recorded",
			},
		},
	}
	if err := New().Handle(context.Background(), adapterInput(t, em, "session.error", "minimal", errorPayload)); err != nil {
		t.Fatalf("minimal session.error: %v", err)
	}
	if len(em.events) != 1 {
		t.Fatalf("minimal error emitted %d events, want one immediate snapshot", len(em.events))
	}
	errorSnapshot := em.events[0]
	if errorSnapshot.Name != semconv.CodingAgentEventSessionSnapshot || errorSnapshot.Attrs[semconv.ErrorType] != "APIError" {
		t.Fatalf("error snapshot did not carry safe error type: %+v", errorSnapshot)
	}
	if errorSnapshot.Attrs[semconv.CodingAgentHookEvent] != "session.error" {
		t.Fatalf("error snapshot hook = %v, want session.error", errorSnapshot.Attrs[semconv.CodingAgentHookEvent])
	}

	idlePayload := map[string]any{
		"event": map[string]any{
			"type":       "session.idle",
			"properties": map[string]any{"sessionID": sessionID},
		},
	}
	input := adapterInput(t, em, "session.idle", "minimal", idlePayload)
	if err := New().Handle(context.Background(), input); err != nil {
		t.Fatalf("following idle: %v", err)
	}
	idleSnapshot := em.events[len(em.events)-1]
	if idleSnapshot.Attrs[semconv.CodingAgentHookEvent] != "session.idle" {
		t.Fatalf("idle snapshot hook = %v, want session.idle", idleSnapshot.Attrs[semconv.CodingAgentHookEvent])
	}
	if _, ok := idleSnapshot.Attrs[semconv.ErrorType]; ok {
		t.Fatalf("idle snapshot repeated stale error type: %+v", idleSnapshot)
	}
	if _, ok := idleSnapshot.Attrs[semconv.CodingAgentSessionOutcome]; ok {
		t.Fatalf("snapshot fabricated terminal outcome: %+v", idleSnapshot)
	}
}

func TestMinimalErrorWithoutTypeStillEmitsImmediateSnapshot(t *testing.T) {
	withIsolatedCache(t)

	const sessionID = "ses_minimal_untyped_error"
	em := &recordingEmitter{}
	payload := map[string]any{
		"event": map[string]any{
			"type": "session.error",
			"properties": map[string]any{
				"sessionID": sessionID,
			},
		},
	}
	if err := New().Handle(context.Background(), adapterInput(t, em, "session.error", "minimal", payload)); err != nil {
		t.Fatalf("minimal untyped session.error: %v", err)
	}
	if len(em.events) != 1 || em.events[0].Name != semconv.CodingAgentEventSessionSnapshot {
		t.Fatalf("minimal untyped error events = %+v, want one immediate snapshot", em.events)
	}
	if em.events[0].Attrs[semconv.CodingAgentHookEvent] != "session.error" {
		t.Fatalf("error snapshot hook = %v, want session.error", em.events[0].Attrs[semconv.CodingAgentHookEvent])
	}
	if _, ok := em.events[0].Attrs[semconv.ErrorType]; ok {
		t.Fatalf("untyped error snapshot fabricated an error type: %+v", em.events[0].Attrs)
	}
}

func TestNonMinimalTurnDoesNotReappearInMinimalSnapshot(t *testing.T) {
	for _, capture := range []string{
		semconv.CodingAgentContentCaptureMetadataOnly,
		semconv.CodingAgentContentCaptureFull,
	} {
		t.Run(capture, func(t *testing.T) {
			withIsolatedCache(t)

			const sessionID = "ses_non_minimal_then_minimal"
			em := &recordingEmitter{}
			adapter := New()
			message := completedAssistantMessage(
				sessionID,
				"msg-visible-turn",
				100,
				20,
				5,
				40,
				10,
				0.0125,
			)
			if err := adapter.Handle(context.Background(), adapterInput(t, em, "message.updated", capture, message)); err != nil {
				t.Fatalf("%s message.updated: %v", capture, err)
			}
			if len(em.llmTurns) != 1 {
				t.Fatalf("%s emitted %d LLM turns, want 1", capture, len(em.llmTurns))
			}

			idle := map[string]any{
				"event": map[string]any{
					"type":       "session.idle",
					"properties": map[string]any{"sessionID": sessionID},
				},
			}
			if err := adapter.Handle(context.Background(), adapterInput(t, em, "session.idle", semconv.CodingAgentContentCaptureMinimal, idle)); err != nil {
				t.Fatalf("minimal session.idle: %v", err)
			}
			if len(em.events) != 1 {
				t.Fatalf("minimal idle emitted %d events, want 1", len(em.events))
			}
			assertSnapshotUsage(t, em.events[0].Attrs, 0, 0, 0, 0)
		})
	}
}

func TestMinimalSnapshotPreservesOnlyPendingMinimalUsageAcrossModeChanges(t *testing.T) {
	withIsolatedCache(t)

	const sessionID = "ses_pending_minimal_usage"
	// Model the real minimal exporter after turn A: it records usage in the
	// lifetime counters but has not emitted a snapshot yet.
	sessionstate.Save(sessionID, "opencode", &sessionstate.State{
		ConversationID: sessionID,
		InputTokens:    10,
		OutputTokens:   2,
		TotalTokens:    15,
		CostUSD:        0.001,
	})

	em := &recordingEmitter{}
	adapter := New()
	message := completedAssistantMessage(
		sessionID,
		"msg-visible-turn-b",
		100,
		20,
		5,
		40,
		10,
		0.0125,
	)
	if err := adapter.Handle(context.Background(), adapterInput(t, em, "message.updated", semconv.CodingAgentContentCaptureMetadataOnly, message)); err != nil {
		t.Fatalf("metadata-only message.updated: %v", err)
	}

	idle := map[string]any{
		"event": map[string]any{
			"type":       "session.idle",
			"properties": map[string]any{"sessionID": sessionID},
		},
	}
	minimalIdle := adapterInput(t, em, "session.idle", semconv.CodingAgentContentCaptureMinimal, idle)
	if err := adapter.Handle(context.Background(), minimalIdle); err != nil {
		t.Fatalf("first minimal session.idle: %v", err)
	}
	assertSnapshotUsage(t, em.events[0].Attrs, 10, 2, 15, 0.001)

	// Model a later minimal turn C. The next snapshot must contain only C.
	state := sessionstate.Load(sessionID, "opencode")
	state.InputTokens += 7
	state.OutputTokens += 3
	state.TotalTokens += 11
	state.CostUSD += 0.002
	sessionstate.Save(sessionID, "opencode", state)
	if err := adapter.Handle(context.Background(), minimalIdle); err != nil {
		t.Fatalf("second minimal session.idle: %v", err)
	}
	assertSnapshotUsage(t, em.events[1].Attrs, 7, 3, 11, 0.002)

	if err := adapter.Handle(context.Background(), minimalIdle); err != nil {
		t.Fatalf("repeated minimal session.idle: %v", err)
	}
	assertSnapshotUsage(t, em.events[2].Attrs, 0, 0, 0, 0)
}

func completedAssistantMessage(sessionID, messageID string, input, output, reasoning, cacheRead, cacheWrite int64, cost float64) map[string]any {
	return map[string]any{
		"event": map[string]any{
			"type": "message.updated",
			"properties": map[string]any{
				"info": map[string]any{
					"id":        messageID,
					"sessionID": sessionID,
					"role":      "assistant",
					"time": map[string]any{
						"created":   int64(1_000),
						"completed": int64(2_000),
					},
					"cost": cost,
					"tokens": map[string]any{
						"input":     input,
						"output":    output,
						"reasoning": reasoning,
						"cache": map[string]any{
							"read":  cacheRead,
							"write": cacheWrite,
						},
					},
				},
			},
		},
	}
}

func assertSnapshotUsage(t *testing.T, attrs map[string]any, input, output, total int64, cost float64) {
	t.Helper()
	if attrs[semconv.GenAIUsageInputTokens] != input || attrs[semconv.GenAIUsageOutputTokens] != output || attrs[semconv.GenAIUsageTotalTokens] != total {
		t.Errorf("snapshot usage = %v/%v/%v, want %d/%d/%d", attrs[semconv.GenAIUsageInputTokens], attrs[semconv.GenAIUsageOutputTokens], attrs[semconv.GenAIUsageTotalTokens], input, output, total)
	}
	gotCost, _ := attrs[semconv.GenAIUsageCost].(float64)
	if math.Abs(gotCost-cost) > 1e-9 {
		t.Errorf("snapshot cost = %v, want %v", attrs[semconv.GenAIUsageCost], cost)
	}
}
