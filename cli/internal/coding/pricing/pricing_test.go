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
		{"claude-sonnet-4-5-20251022", Rate{InputPer1M: 3.00, OutputPer1M: 15.00, CachedInputPer1M: 0.30}},
		{"claude-3-5-sonnet-20241022", Rate{InputPer1M: 3.00, OutputPer1M: 15.00, CachedInputPer1M: 0.30}},
		{"claude-opus-4-7", Rate{InputPer1M: 15.00, OutputPer1M: 75.00, CachedInputPer1M: 1.50}},
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
	r := Rate{InputPer1M: 3.00, OutputPer1M: 15.00, CachedInputPer1M: 0.30}
	got := r.Cost(10_000, 2_000, 0)
	want := 0.06 // 10k*3/1M + 2k*15/1M = 0.03 + 0.03
	if math.Abs(got-want) > 1e-9 {
		t.Errorf("Cost(10k,2k,0) = %v, want %v", got, want)
	}
}

func TestCostWithCachedInput(t *testing.T) {
	r := Rate{InputPer1M: 3.00, OutputPer1M: 15.00, CachedInputPer1M: 0.30}
	// 8000 cached + 2000 fresh = 10000 input tokens; 2000 output.
	got := r.Cost(10_000, 2_000, 8_000)
	// Fresh: 2000 * 3/1M = 0.006
	// Cached: 8000 * 0.30/1M = 0.0024
	// Output: 2000 * 15/1M = 0.030
	want := 0.0384
	if math.Abs(got-want) > 1e-9 {
		t.Errorf("cached cost = %v, want %v", got, want)
	}
}

func TestCostZeroRate(t *testing.T) {
	r := Rate{}
	if got := r.Cost(1_000, 1_000, 0); got != 0 {
		t.Errorf("zero rate must return 0, got %v", got)
	}
}
