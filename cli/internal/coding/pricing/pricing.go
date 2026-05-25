// Package pricing returns realized USD cost from token counts using a
// small static table of public list prices.
//
// The CLI is short-lived and offline-safe; we do not fetch live pricing.
// Rates here are last-known public list prices (2026-05) and are kept
// deliberately conservative — we'd rather under-bill than over-bill the
// dashboard. The server can replace these with org-specific contract
// rates at materialization time.
//
// All rates are USD per 1,000,000 tokens.
package pricing

import "strings"

// Rate captures input + output rates for a model family.
type Rate struct {
	InputPer1M  float64
	OutputPer1M float64
	// Cached input rate (Anthropic ephemeral cache reads). When zero,
	// CostUSD treats cache reads as full input rate.
	CachedInputPer1M float64
}

// Cost returns the realized USD cost for the supplied token counts.
// `cachedInput` is the subset of `input` that came from prompt cache
// (Anthropic exposes this; OpenAI surfaces it via cached_tokens). It
// MUST already be subtracted from `input` if you want it billed at the
// cached rate; passing 0 bills everything at the standard rate.
func (r Rate) Cost(input, output, cachedInput int64) float64 {
	if r.InputPer1M == 0 && r.OutputPer1M == 0 {
		return 0
	}
	cachedRate := r.CachedInputPer1M
	if cachedRate == 0 {
		cachedRate = r.InputPer1M
	}
	freshInput := input - cachedInput
	if freshInput < 0 {
		freshInput = 0
	}
	return (float64(freshInput)*r.InputPer1M +
		float64(cachedInput)*cachedRate +
		float64(output)*r.OutputPer1M) / 1_000_000.0
}

// Lookup returns the best-effort rate for a given model id. Matching is
// substring-based (case-insensitive) so we don't have to enumerate every
// minor revision (e.g. claude-sonnet-4-5-20251022 still matches "claude-sonnet-4").
//
// Returns the zero Rate (which produces $0) when nothing matches; the
// caller should fall through to "no cost data" rather than guessing.
func Lookup(model string) Rate {
	low := strings.ToLower(model)
	for _, e := range table {
		for _, pat := range e.match {
			if strings.Contains(low, pat) {
				return e.rate
			}
		}
	}
	return Rate{}
}

type entry struct {
	match []string
	rate  Rate
}

// table is intentionally small. Each entry covers a model family; the
// patterns are substrings so we tolerate vendor revisions without code
// edits. Order matters — first-match wins, so put more-specific
// patterns ahead of broader ones.
//
// References:
//   - Anthropic: https://www.anthropic.com/pricing#anthropic-api
//   - OpenAI:    https://openai.com/api/pricing/
//   - Google:    https://ai.google.dev/pricing
var table = []entry{
	// --- Anthropic Claude family -----------------------------------
	{
		match: []string{"claude-opus-4", "claude-4-opus"},
		rate:  Rate{InputPer1M: 15.00, OutputPer1M: 75.00, CachedInputPer1M: 1.50},
	},
	{
		match: []string{"claude-sonnet-4", "claude-4-sonnet", "claude-4.5-sonnet", "claude-sonnet-4-5"},
		rate:  Rate{InputPer1M: 3.00, OutputPer1M: 15.00, CachedInputPer1M: 0.30},
	},
	{
		match: []string{"claude-haiku-4", "claude-4-haiku", "claude-haiku-4-5"},
		rate:  Rate{InputPer1M: 1.00, OutputPer1M: 5.00, CachedInputPer1M: 0.10},
	},
	{
		match: []string{"claude-3-7-sonnet", "claude-3.7-sonnet"},
		rate:  Rate{InputPer1M: 3.00, OutputPer1M: 15.00, CachedInputPer1M: 0.30},
	},
	{
		match: []string{"claude-3-5-haiku", "claude-3.5-haiku"},
		rate:  Rate{InputPer1M: 0.80, OutputPer1M: 4.00, CachedInputPer1M: 0.08},
	},
	{
		match: []string{"claude-3-5-sonnet", "claude-3.5-sonnet"},
		rate:  Rate{InputPer1M: 3.00, OutputPer1M: 15.00, CachedInputPer1M: 0.30},
	},
	{
		match: []string{"claude-3-opus", "claude-3.0-opus"},
		rate:  Rate{InputPer1M: 15.00, OutputPer1M: 75.00, CachedInputPer1M: 1.50},
	},
	// --- OpenAI ----------------------------------------------------
	{
		match: []string{"gpt-5.5", "gpt-5-5"},
		rate:  Rate{InputPer1M: 1.25, OutputPer1M: 10.00, CachedInputPer1M: 0.125},
	},
	{
		match: []string{"gpt-5.3-codex", "codex-5.3", "gpt-5-3-codex"},
		rate:  Rate{InputPer1M: 1.25, OutputPer1M: 10.00, CachedInputPer1M: 0.125},
	},
	{
		match: []string{"gpt-5", "o5"},
		rate:  Rate{InputPer1M: 2.50, OutputPer1M: 10.00, CachedInputPer1M: 0.25},
	},
	{
		match: []string{"gpt-4o", "gpt-4-o"},
		rate:  Rate{InputPer1M: 2.50, OutputPer1M: 10.00, CachedInputPer1M: 1.25},
	},
	{
		match: []string{"gpt-4-turbo", "gpt-4-1106", "gpt-4-0125"},
		rate:  Rate{InputPer1M: 10.00, OutputPer1M: 30.00},
	},
	{
		match: []string{"o1-mini"},
		rate:  Rate{InputPer1M: 3.00, OutputPer1M: 12.00},
	},
	{
		match: []string{"o1-preview", "o1-pro"},
		rate:  Rate{InputPer1M: 15.00, OutputPer1M: 60.00},
	},
	{
		match: []string{"o3-mini"},
		rate:  Rate{InputPer1M: 1.10, OutputPer1M: 4.40},
	},
	{
		match: []string{"o4-mini"},
		rate:  Rate{InputPer1M: 1.10, OutputPer1M: 4.40},
	},
	// --- Google Gemini ---------------------------------------------
	{
		match: []string{"gemini-2.5-pro", "gemini-2-5-pro"},
		rate:  Rate{InputPer1M: 1.25, OutputPer1M: 10.00},
	},
	{
		match: []string{"gemini-2.5-flash", "gemini-2-5-flash"},
		rate:  Rate{InputPer1M: 0.30, OutputPer1M: 2.50},
	},
	{
		match: []string{"gemini-1.5-pro", "gemini-1-5-pro"},
		rate:  Rate{InputPer1M: 1.25, OutputPer1M: 5.00},
	},
	{
		match: []string{"gemini-1.5-flash", "gemini-1-5-flash"},
		rate:  Rate{InputPer1M: 0.075, OutputPer1M: 0.30},
	},
}
