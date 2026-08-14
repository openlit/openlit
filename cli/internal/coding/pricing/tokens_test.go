package pricing

import "testing"

func TestEstimateTokensEmpty(t *testing.T) {
	if got := EstimateTokens(""); got != 0 {
		t.Errorf("expected 0 for empty, got %d", got)
	}
}

func TestEstimateTokensShort(t *testing.T) {
	got := EstimateTokens("hello world")
	if got <= 0 {
		t.Errorf("expected >0, got %d", got)
	}
}

func TestEstimateTokensWordFloor(t *testing.T) {
	// "a b c d e f g h" = 8 single-char words, 15 chars
	// charEstimate = 4, wordFloor = 8*4/3 = 10
	// → returns 10 (word floor wins for short word-dense text)
	got := EstimateTokens("a b c d e f g h")
	if got < 10 {
		t.Errorf("expected word floor to win (>=10), got %d", got)
	}
}
