package pricing

import (
	"math"
	"testing"
)

func TestLookupAnthropic(t *testing.T) {
	tests := []struct {
		model string
		want  Rate
	}{
		// Sonnet 4.x / 3.5: $3/$15 across all minor revisions.
		{"claude-sonnet-4-5-20251022", Rate{InputPer1M: 3.00, OutputPer1M: 15.00, CachedReadPer1M: 0.30, CacheCreationPer1M: 3.75}},
		{"claude-3-5-sonnet-20241022", Rate{InputPer1M: 3.00, OutputPer1M: 15.00, CachedReadPer1M: 0.30, CacheCreationPer1M: 3.75}},
		// Opus 4.5+ dropped to $5/$25 in 2025-10. Cursor's Cmd-K hook
		// stamps `claude-opus-4-7-thinking-xhigh` so we exercise the
		// versioned-with-suffix pattern explicitly: regressing this
		// inflates dashboard cost ~3x (back to the legacy Opus rate).
		{"claude-opus-4-8", Rate{InputPer1M: 5.00, OutputPer1M: 25.00, CachedReadPer1M: 0.50, CacheCreationPer1M: 6.25}},
		{"claude-opus-4-7", Rate{InputPer1M: 5.00, OutputPer1M: 25.00, CachedReadPer1M: 0.50, CacheCreationPer1M: 6.25}},
		{"claude-opus-4-7-thinking-xhigh", Rate{InputPer1M: 5.00, OutputPer1M: 25.00, CachedReadPer1M: 0.50, CacheCreationPer1M: 6.25}},
		{"claude-opus-4-6", Rate{InputPer1M: 5.00, OutputPer1M: 25.00, CachedReadPer1M: 0.50, CacheCreationPer1M: 6.25}},
		{"claude-opus-4-5", Rate{InputPer1M: 5.00, OutputPer1M: 25.00, CachedReadPer1M: 0.50, CacheCreationPer1M: 6.25}},
		// Anthropic priority-tier "-fast" variants carry a 6x markup
		// (and roughly 6x cache-write rate); Cursor exposes these.
		{"claude-opus-4-8-fast", Rate{InputPer1M: 30.00, OutputPer1M: 150.00, CachedReadPer1M: 3.00, CacheCreationPer1M: 37.50}},
		// Legacy Opus 4.0 / 4.1 are still on the original $15/$75 list.
		{"claude-opus-4-0", Rate{InputPer1M: 15.00, OutputPer1M: 75.00, CachedReadPer1M: 1.50, CacheCreationPer1M: 18.75}},
		{"claude-opus-4-1", Rate{InputPer1M: 15.00, OutputPer1M: 75.00, CachedReadPer1M: 1.50, CacheCreationPer1M: 18.75}},
		// Haiku 4.x: $1/$5.
		{"claude-haiku-4-5-20251001", Rate{InputPer1M: 1.00, OutputPer1M: 5.00, CachedReadPer1M: 0.10, CacheCreationPer1M: 1.25}},
		// Bare "claude-opus-4" with no version falls into the modern
		// bucket — we'd rather undercharge than 3x-overcharge a new SKU
		// before the table catches up.
		{"claude-opus-4", Rate{InputPer1M: 5.00, OutputPer1M: 25.00, CachedReadPer1M: 0.50, CacheCreationPer1M: 6.25}},
	}
	for _, tt := range tests {
		got := Lookup(tt.model)
		if got != tt.want {
			t.Errorf("Lookup(%q) = %+v, want %+v", tt.model, got, tt.want)
		}
	}
}

func TestLookupOpenAI(t *testing.T) {
	tests := []struct {
		model string
		want  Rate
	}{
		// GPT-5 base: $1.25/$10. Cursor and Codex stamp this directly.
		{"gpt-5", Rate{InputPer1M: 1.25, OutputPer1M: 10.00, CachedReadPer1M: 0.125}},
		{"gpt-5-codex", Rate{InputPer1M: 1.25, OutputPer1M: 10.00, CachedReadPer1M: 0.125}},
		{"gpt-5-mini", Rate{InputPer1M: 0.25, OutputPer1M: 2.00, CachedReadPer1M: 0.025}},
		{"gpt-5-nano", Rate{InputPer1M: 0.05, OutputPer1M: 0.40, CachedReadPer1M: 0.005}},
		{"gpt-5-fast", Rate{InputPer1M: 2.50, OutputPer1M: 20.00, CachedReadPer1M: 0.25}},
		// GPT-5.1 codex variants.
		{"gpt-5.1-codex-mini", Rate{InputPer1M: 0.25, OutputPer1M: 2.00, CachedReadPer1M: 0.025}},
		{"gpt-5.1-codex-max", Rate{InputPer1M: 1.25, OutputPer1M: 10.00, CachedReadPer1M: 0.125}},
		// GPT-5.4 jumped to $2.50/$15 — used by Codex CLI in our test data.
		{"gpt-5.4", Rate{InputPer1M: 2.50, OutputPer1M: 15.00, CachedReadPer1M: 0.25}},
		{"gpt-5.4-mini", Rate{InputPer1M: 0.75, OutputPer1M: 4.50, CachedReadPer1M: 0.075}},
		// GPT-5.5 frontier tier.
		{"gpt-5.5", Rate{InputPer1M: 5.00, OutputPer1M: 30.00, CachedReadPer1M: 0.50}},
		// o-series — confirm o3 isn't being eaten by the gpt-5 family.
		{"o3", Rate{InputPer1M: 2.00, OutputPer1M: 8.00}},
		{"o4-mini", Rate{InputPer1M: 1.10, OutputPer1M: 4.40}},
	}
	for _, tt := range tests {
		got := Lookup(tt.model)
		if got != tt.want {
			t.Errorf("Lookup(%q) = %+v, want %+v", tt.model, got, tt.want)
		}
	}
}

func TestLookupGoogle(t *testing.T) {
	tests := []struct {
		model string
		want  Rate
	}{
		{"gemini-2.5-pro", Rate{InputPer1M: 1.25, OutputPer1M: 10.00}},
		{"gemini-2.5-flash", Rate{InputPer1M: 0.30, OutputPer1M: 2.50}},
		{"gemini-2.5-flash-lite", Rate{InputPer1M: 0.10, OutputPer1M: 0.40}},
		{"gemini-3-flash", Rate{InputPer1M: 0.50, OutputPer1M: 3.00}},
		{"gemini-3-pro", Rate{InputPer1M: 2.00, OutputPer1M: 12.00}},
		{"gemini-3.5-flash", Rate{InputPer1M: 1.50, OutputPer1M: 9.00}},
		{"gemini-3.1-pro", Rate{InputPer1M: 2.00, OutputPer1M: 12.00}},
	}
	for _, tt := range tests {
		got := Lookup(tt.model)
		if got != tt.want {
			t.Errorf("Lookup(%q) = %+v, want %+v", tt.model, got, tt.want)
		}
	}
}

func TestLookupXAIAndCursorAndMoonshot(t *testing.T) {
	tests := []struct {
		model string
		want  Rate
	}{
		// xAI Grok ladder.
		{"grok-4-20", Rate{InputPer1M: 2.00, OutputPer1M: 6.00, CachedReadPer1M: 0.20}},
		{"grok-4-3", Rate{InputPer1M: 1.25, OutputPer1M: 2.50, CachedReadPer1M: 0.20}},
		{"grok-build-0-1", Rate{InputPer1M: 1.00, OutputPer1M: 2.00, CachedReadPer1M: 0.20}},
		// Cursor Composer.
		{"composer-2-5", Rate{InputPer1M: 0.50, OutputPer1M: 2.50, CachedReadPer1M: 0.20}},
		{"composer-1-5", Rate{InputPer1M: 3.50, OutputPer1M: 17.50, CachedReadPer1M: 0.35}},
		{"composer-1", Rate{InputPer1M: 1.25, OutputPer1M: 10.00, CachedReadPer1M: 0.125}},
		// Moonshot.
		{"kimi-k2-5", Rate{InputPer1M: 0.60, OutputPer1M: 3.00, CachedReadPer1M: 0.10}},
	}
	for _, tt := range tests {
		got := Lookup(tt.model)
		if got != tt.want {
			t.Errorf("Lookup(%q) = %+v, want %+v", tt.model, got, tt.want)
		}
	}
}

func TestLookupUnknown(t *testing.T) {
	got := Lookup("totally-made-up-model-9000")
	if got.InputPer1M != 0 || got.OutputPer1M != 0 {
		t.Errorf("expected zero rate for unknown, got %+v", got)
	}
}

func TestCostBasic(t *testing.T) {
	r := Rate{InputPer1M: 3.00, OutputPer1M: 15.00, CachedReadPer1M: 0.30, CacheCreationPer1M: 3.75}
	got := r.Cost(10_000, 2_000, 0, 0)
	want := 0.06 // 10k*3/1M + 2k*15/1M = 0.03 + 0.03
	if math.Abs(got-want) > 1e-9 {
		t.Errorf("Cost(10k,2k,0,0) = %v, want %v", got, want)
	}
}

func TestCostWithCacheRead(t *testing.T) {
	r := Rate{InputPer1M: 3.00, OutputPer1M: 15.00, CachedReadPer1M: 0.30, CacheCreationPer1M: 3.75}
	// 8000 cache reads + 2000 fresh = 10000 input tokens; 2000 output;
	// no cache creation.
	got := r.Cost(10_000, 2_000, 8_000, 0)
	// Fresh: 2000 * 3/1M = 0.006
	// Cache read: 8000 * 0.30/1M = 0.0024
	// Output: 2000 * 15/1M = 0.030
	want := 0.0384
	if math.Abs(got-want) > 1e-9 {
		t.Errorf("cache-read cost = %v, want %v", got, want)
	}
}

// TestCostCacheCreationPremium is the regression net for the
// Claude Code under-billing bug: before the cache_creation split,
// cache_creation tokens were billed at the cache_read rate (~10% of
// input) instead of the cache_write rate (~125% of input), a ~12x
// gap on the cache-write portion. This test pins the new behaviour.
func TestCostCacheCreationPremium(t *testing.T) {
	r := Rate{InputPer1M: 5.00, OutputPer1M: 25.00, CachedReadPer1M: 0.50, CacheCreationPer1M: 6.25}
	// 2000 fresh + 6000 cache-read + 2000 cache-create = 10000 input;
	// 2000 output. This mirrors a realistic Claude Opus 4.x turn.
	got := r.Cost(10_000, 2_000, 6_000, 2_000)
	// Fresh:        2000 * 5/1M    = 0.010
	// Cache read:   6000 * 0.50/1M = 0.003
	// Cache create: 2000 * 6.25/1M = 0.0125
	// Output:       2000 * 25/1M   = 0.050
	// Total = 0.0755
	want := 0.0755
	if math.Abs(got-want) > 1e-9 {
		t.Errorf("cache-creation cost = %v, want %v", got, want)
	}

	// Bundling the cache_creation tokens under cache_read (the pre-fix
	// behaviour) would have yielded a far smaller bill — verify the
	// new path is strictly higher to guard against silent regression.
	bundledUnderRead := r.Cost(10_000, 2_000, 8_000, 0)
	if got <= bundledUnderRead {
		t.Errorf("cache_creation premium must be billed: split=%v, bundled-as-read=%v", got, bundledUnderRead)
	}
}

// TestCostCacheCreationFallback documents the safety fallback: when
// a Rate entry forgets to set CacheCreationPer1M but the call has
// cache_creation tokens, we fall back to InputPer1M instead of $0.
// This guarantees missing-rate bugs under-bill by a small margin
// rather than silently dropping cache-write tokens to free.
func TestCostCacheCreationFallback(t *testing.T) {
	r := Rate{InputPer1M: 4.00, OutputPer1M: 16.00, CachedReadPer1M: 0.40 /* no CacheCreationPer1M */}
	// 0 fresh + 0 cache_read + 1000 cache_creation; 0 output.
	got := r.Cost(1_000, 0, 0, 1_000)
	// Fallback bills cache_creation at InputPer1M: 1000 * 4/1M = 0.004
	want := 0.004
	if math.Abs(got-want) > 1e-9 {
		t.Errorf("cache_creation fallback cost = %v, want %v", got, want)
	}
}

func TestCostZeroRate(t *testing.T) {
	r := Rate{}
	if got := r.Cost(1_000, 1_000, 0, 0); got != 0 {
		t.Errorf("zero rate must return 0, got %v", got)
	}
}
