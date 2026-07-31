package pricing

import "strings"

// EstimateTokens returns an approximate token count for a UTF-8 string
// using the canonical "4 chars ≈ 1 token" heuristic, with a whitespace-
// aware floor (so we never under-bill multi-word prompts).
//
// This is a fallback for vendors that don't expose token counts on
// every hook event (Cursor's beforeSubmitPrompt still gives us only
// the text; afterAgentResponse / stop may carry real
// input_tokens / output_tokens / cache_* — prefer those when present).
// When the vendor does report usage (Claude Code's transcript JSONL,
// Codex rollout JSONL, Cursor stop/afterAgentResponse), prefer that
// authoritative number — this estimator is intentionally conservative
// so we never silently inflate cost.
//
// Heuristic chosen to match what Anthropic's tokenizer roughly produces
// on English/code prompts (their actual ratio runs 3.5–4.5 chars/tok
// depending on content; we land at the middle).
func EstimateTokens(text string) int64 {
	if text == "" {
		return 0
	}
	// Char-based estimate dominates for code-heavy prompts.
	chars := int64(len(text))
	charEstimate := chars / 4
	if chars%4 != 0 {
		charEstimate++
	}

	// Word-based floor for natural-language prompts where chars/4
	// under-counts (lots of short words = more tokens than the char
	// ratio implies).
	words := int64(len(strings.Fields(text)))
	wordFloor := (words * 4) / 3 // ~0.75 word/token

	if wordFloor > charEstimate {
		return wordFloor
	}
	return charEstimate
}
