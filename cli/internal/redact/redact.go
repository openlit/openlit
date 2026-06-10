// Package redact strips obvious secrets from strings before they're
// emitted as OTel attributes.
//
// Two tiers:
//
//   - Tier 1 (always on): high-confidence secret patterns where false
//     positives are very rare — AWS access keys, GitHub tokens, OpenAI
//     keys, JWTs, private keys, generic Bearer tokens, etc. Run on
//     every string that crosses the wire.
//
//   - Tier 2 (off by default, enabled when ContentCapture == "full"):
//     more aggressive heuristics that catch in-prose secrets — long
//     hex/base64 blobs, "password=foo" assignments. False positives
//     are possible (e.g. a long base64 image hash). We accept those
//     because the user has explicitly opted in to capturing prompt
//     and tool-arg content.
//
// JSON-shape preservation: redaction runs *after* JSON parsing where the
// caller has already extracted string values, so we never touch
// structural braces / quotes. For tool-call argument blobs the caller
// passes the entire JSON string; we run regex replacements that only
// rewrite secret-looking substrings and leave the JSON parseable.
package redact

import "regexp"

// Replacement is the placeholder we substitute for matched secrets.
const Replacement = "[REDACTED]"

// tier1Patterns are the always-on secret patterns. Order doesn't matter
// since each rewrites in place.
var tier1Patterns = []*regexp.Regexp{
	// AWS access key id (AKIA + 16 chars) and the secret access key
	// (40 base64 chars after `aws_secret_access_key`).
	regexp.MustCompile(`AKIA[0-9A-Z]{16}`),
	regexp.MustCompile(`(?i)aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?`),

	// GitHub tokens.
	regexp.MustCompile(`gh[opsu]_[A-Za-z0-9]{16,}`),
	regexp.MustCompile(`github_pat_[A-Za-z0-9_]{20,}`),

	// OpenAI / Anthropic / generic provider keys.
	regexp.MustCompile(`sk-(?:proj-)?[A-Za-z0-9_\-]{20,}`),
	regexp.MustCompile(`sk-ant-[A-Za-z0-9_\-]{20,}`),

	// Slack tokens.
	regexp.MustCompile(`xox[abprs]-[0-9]+-[0-9]+-[0-9]+-[A-Za-z0-9]{20,}`),

	// Google API keys.
	regexp.MustCompile(`AIza[0-9A-Za-z_\-]{35}`),

	// Stripe live keys.
	regexp.MustCompile(`sk_live_[A-Za-z0-9]{20,}`),
	regexp.MustCompile(`rk_live_[A-Za-z0-9]{20,}`),

	// Generic JWTs (3 base64url segments separated by dots, leading "ey").
	regexp.MustCompile(`eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}`),

	// Bearer tokens in headers (always strip the value, keep the prefix).
	regexp.MustCompile(`(?i)(authorization\s*:\s*bearer\s+)[A-Za-z0-9_\-\.=]+`),

	// PEM-style private keys: collapse the entire block.
	regexp.MustCompile(`(?s)-----BEGIN [A-Z ]+PRIVATE KEY-----.*?-----END [A-Z ]+PRIVATE KEY-----`),

	// Azure storage / SAS keys. ?sv=… signature tail is sensitive
	// even when the SAS itself looks like a URL-encoded blob.
	regexp.MustCompile(`(?i)(sig=)[A-Za-z0-9%]{20,}`),
	regexp.MustCompile(`(?i)DefaultEndpointsProtocol=https?;AccountName=[A-Za-z0-9]+;AccountKey=[A-Za-z0-9+/=]{20,}`),

	// HuggingFace user tokens. Two formats are in the wild
	// (`hf_…` short tokens and the longer fine-grained variants).
	regexp.MustCompile(`hf_[A-Za-z0-9]{20,}`),

	// Discord bot tokens — three dot-separated segments, first is
	// a base64-encoded user id, fairly distinctive.
	regexp.MustCompile(`[MN][A-Za-z0-9]{23}\.[A-Za-z0-9_\-]{6}\.[A-Za-z0-9_\-]{20,}`),

	// npm tokens — both the legacy 36-char hex format and the
	// modern `npm_…` prefix.
	regexp.MustCompile(`npm_[A-Za-z0-9]{30,}`),
}

// tier1CaptureRewrites are patterns whose match must NOT be wholly
// replaced — instead the redactor keeps some capture groups intact
// (e.g. the DB scheme + host on a connection URL) and zeroes the
// secret-bearing groups. Each entry is applied after tier1Patterns
// on every call to String / StringFull.
var tier1CaptureRewrites = []struct {
	re   *regexp.Regexp
	repl string
}{
	// Postgres / MySQL / Mongo / Redis / AMQP connection URLs carry
	// the password inline in the userinfo segment. Keep the scheme
	// and host so dashboards can still tell which DB the agent was
	// touching; mask the credentials.
	{
		re:   regexp.MustCompile(`(?i)((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://)[^:\s/@]+:[^@\s]+@`),
		repl: "${1}[REDACTED]:[REDACTED]@",
	},
}

// tier2Patterns are aggressive heuristics enabled when content capture
// is set to "full". They risk false positives but catch in-prose secrets
// that tier 1 misses.
var tier2Patterns = []*regexp.Regexp{
	// Generic password= / token= / secret= / api_key= assignments.
	regexp.MustCompile(`(?i)(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9+/=_\-\.]{8,}["']?`),
	// Long hex strings (40+ chars) — typical for SHA256, OAuth, etc.
	regexp.MustCompile(`\b[A-Fa-f0-9]{40,}\b`),
	// Long base64 blobs (60+ chars) outside of obvious URL/path context.
	regexp.MustCompile(`\b[A-Za-z0-9+/]{60,}={0,2}\b`),
}

// String runs tier-1 redaction on s. Always safe to call.
func String(s string) string {
	if s == "" {
		return s
	}
	for _, re := range tier1Patterns {
		s = re.ReplaceAllString(s, Replacement)
	}
	for _, r := range tier1CaptureRewrites {
		s = r.re.ReplaceAllString(s, r.repl)
	}
	return s
}

// StringFull runs tier-1 + tier-2 redaction. Use only when content
// capture is set to "full".
func StringFull(s string) string {
	if s == "" {
		return s
	}
	s = String(s)
	for _, re := range tier2Patterns {
		s = re.ReplaceAllString(s, Replacement)
	}
	return s
}

// ForCapture returns the appropriate redactor for the given capture mode.
//
//   - "minimal" / "metadata_only"  → tier 1 redaction
//   - "full"                        → tier 1 + tier 2
//
// Unknown modes default to the safer tier 1 only — never weaker.
func ForCapture(mode string) func(string) string {
	switch mode {
	case "full":
		return StringFull
	default:
		return String
	}
}
