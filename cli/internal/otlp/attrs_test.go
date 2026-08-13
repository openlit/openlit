package otlp

import "testing"

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
