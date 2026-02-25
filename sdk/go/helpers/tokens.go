package helpers

import (
	"strings"
)

// EstimateTokenCount provides a rough estimation of token count
// This is a simple approximation - for accurate counts, use tiktoken or similar
func EstimateTokenCount(text string) int {
	if text == "" {
		return 0
	}

	// Simple approximation: ~4 characters per token
	// This matches the rough heuristic used in the industry
	charCount := len(text)
	tokenCount := charCount / 4

	// Account for word boundaries - each word is typically at least 1 token
	words := strings.Fields(text)
	if len(words) > tokenCount {
		tokenCount = len(words)
	}

	return tokenCount
}

// EstimateTokensFromMessages estimates tokens from a list of messages
func EstimateTokensFromMessages(messages []string) int {
	total := 0
	for _, msg := range messages {
		total += EstimateTokenCount(msg)
	}
	return total
}

// TokenStats holds token usage statistics
type TokenStats struct {
	InputTokens  int
	OutputTokens int
	TotalTokens  int
}

// NewTokenStats creates a new TokenStats instance
func NewTokenStats(input, output int) TokenStats {
	return TokenStats{
		InputTokens:  input,
		OutputTokens: output,
		TotalTokens:  input + output,
	}
}

// Add adds another TokenStats to this one
func (ts *TokenStats) Add(other TokenStats) {
	ts.InputTokens += other.InputTokens
	ts.OutputTokens += other.OutputTokens
	ts.TotalTokens += other.TotalTokens
}
