package otlp

import (
	"context"
	"testing"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/sdk/go/semconv"
)

func TestInferProvider(t *testing.T) {
	tests := []struct {
		model, vendor, want string
	}{
		{"claude-opus-4-8", "cursor", "anthropic"},
		{"claude-opus-4-8-thinking-high", "cursor", "anthropic"},
		{"gpt-5.5", "codex", "openai"},
		{"gpt-5.6-sol-medium", "cursor", "openai"},
		{"cursor-grok-4.5-high", "cursor", "xai"},
		{"grok-4.5", "cursor", "xai"},
		{"composer-2.5", "cursor", "cursor"},
		{"composer-2-5", "cursor", "cursor"},
		{"auto", "cursor", "cursor"},
		{"gemini-3-pro", "", "google"},
		{"kimi-k2.7-code", "cursor", "moonshot"},
		{"", "cursor", "cursor"},
		{"", "codex", "openai"},
		{"", "claude-code", "anthropic"},
		{"totally-unknown", "", ""},
	}
	for _, tt := range tests {
		got := inferProvider(tt.model, tt.vendor)
		if got != tt.want {
			t.Errorf("inferProvider(%q, %q) = %q, want %q", tt.model, tt.vendor, got, tt.want)
		}
	}
}

func TestToolCallAttrsAlwaysIncludeRequiredDurationAndErrored(t *testing.T) {
	tracer, exporter, shutdown := newTestTracer(t)
	defer shutdown()

	_, span := tracer.Start(context.Background(), "tool")
	now := time.Now()
	setToolCallAttrs(span, normalize.ToolCall{
		SessionID: "ses_required",
		ToolName:  "bash",
		ToolUseID: "call_required",
		Vendor:    "opencode",
		StartedAt: now,
		EndedAt:   now,
	}, func(value string) string { return value }, "metadata_only")
	span.End()

	spans := exporter.GetSpans()
	if len(spans) != 1 {
		t.Fatalf("got %d spans, want 1", len(spans))
	}
	attrs := map[string]any{}
	for _, attr := range spans[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.AsInterface()
	}
	if got, ok := attrs["coding_agent.tool.duration_ms"]; !ok || got != int64(0) {
		t.Errorf("duration_ms = %v (present=%v), want int64(0)", got, ok)
	}
	if got, ok := attrs["coding_agent.tool.errored"]; !ok || got != false {
		t.Errorf("errored = %v (present=%v), want false", got, ok)
	}
}

func TestMinimalModeAllowsOnlySessionSnapshotEvents(t *testing.T) {
	if !eventSpanAllowed("minimal", semconv.CodingAgentEventSessionSnapshot) {
		t.Fatal("minimal mode suppressed the OpenCode session snapshot")
	}
	if eventSpanAllowed("minimal", "coding_agent.session.loop.stop") {
		t.Fatal("minimal mode allowed an ordinary per-event span")
	}
	if !eventSpanAllowed("metadata_only", "coding_agent.session.loop.stop") {
		t.Fatal("metadata mode suppressed an ordinary event span")
	}
	if eventSpanAllowed("minimal", "coding_agent.session.snapshot.unreviewed") {
		t.Fatal("minimal mode allowed an unregistered snapshot-prefixed event")
	}
}

func TestLLMTurnUsesNumericCanonicalReasoningTokens(t *testing.T) {
	tracer, exporter, shutdown := newTestTracer(t)
	defer shutdown()

	_, span := tracer.Start(context.Background(), "llm")
	setLLMTurnAttrs(span, normalize.LLMTurn{
		SessionID:       "ses_reasoning",
		Vendor:          "opencode",
		ReasoningTokens: 7,
	}, func(value string) string { return value }, "metadata_only")
	span.End()

	spans := exporter.GetSpans()
	if len(spans) != 1 {
		t.Fatalf("got %d spans, want 1", len(spans))
	}
	attrs := map[string]any{}
	for _, attr := range spans[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.AsInterface()
	}
	if got, ok := attrs[semconv.GenAIUsageReasoningTokens]; !ok || got != int64(7) {
		t.Errorf("reasoning tokens = %v (present=%v), want int64(7)", got, ok)
	}
	if _, ok := attrs["coding_agent.llm.reasoning.tokens"]; ok {
		t.Error("emitted ad-hoc string reasoning token attribute")
	}
}

func TestLLMTurnUsesCanonicalKindValues(t *testing.T) {
	tests := []struct {
		name string
		turn normalize.LLMTurn
		want string
	}{
		{
			name: "prompt",
			turn: normalize.LLMTurn{Prompt: "hello"},
			want: semconv.CodingAgentLLMTurnKindPrompt,
		},
		{
			name: "assistant response",
			turn: normalize.LLMTurn{AssistantMessageOnly: true},
			want: semconv.CodingAgentLLMTurnKindResponse,
		},
		{
			name: "response body",
			turn: normalize.LLMTurn{Response: "hello"},
			want: semconv.CodingAgentLLMTurnKindResponse,
		},
		{
			name: "thought",
			turn: normalize.LLMTurn{ThoughtText: "considering"},
			want: semconv.CodingAgentLLMTurnKindThought,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tracer, exporter, shutdown := newTestTracer(t)
			defer shutdown()

			_, span := tracer.Start(context.Background(), "llm")
			turn := tt.turn
			turn.SessionID = "ses_kind"
			turn.Vendor = semconv.CodingAgentVendorOpenCode
			setLLMTurnAttrs(span, turn, func(value string) string { return value }, "metadata_only")
			span.End()

			spans := exporter.GetSpans()
			if len(spans) != 1 {
				t.Fatalf("got %d spans, want 1", len(spans))
			}
			attrs := map[string]any{}
			for _, attr := range spans[0].Attributes {
				attrs[string(attr.Key)] = attr.Value.AsInterface()
			}
			if got := attrs[semconv.CodingAgentLLMTurnKind]; got != tt.want {
				t.Errorf("turn kind = %v, want %q", got, tt.want)
			}
		})
	}
}
