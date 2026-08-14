// Package classify decides whether a coding-agent session is "work" or
// "personal" based on high-confidence signals only.
//
// Two inputs:
//
//  1. API-key identity. If the openlit API key sending this telemetry
//     is on the org's allowlist (configured in OpenLit's settings),
//     the user is recognized as a work identity.
//
//  2. Repo origin. If the repo's remote URL matches one of the org's
//     allowlist patterns (e.g. github.com/our-org/*), the code is
//     work code.
//
// Surveillance-grade signals (keystroke timing, hours-of-day) explicitly
// NOT used. The classification reason is stamped alongside the
// classification so users can see why and dispute it.
package classify

import (
	"strings"
)

// Classification is the result for one session.
type Classification struct {
	Value  string // "work" | "personal" | "disputed" | "unknown"
	Reason string // human-readable signal name, e.g. "api_key_allowlist+repo_origin_match"
}

// Inputs are the signals we have at hook time.
//
// Both API-key fields are tristate-encoded across two booleans to avoid
// the classic "is `false` an answer or a missing signal?" ambiguity:
//
//   - APIKeyAllowlistKnown=false  → we don't know either way. Treat the
//     API-key signal as absent and lean on the repo signal.
//   - APIKeyAllowlistKnown=true   → APIKeyOnAllowlist is authoritative.
type Inputs struct {
	// APIKeyOnAllowlist is true when the request's API key is
	// registered as a "work identity" at the OpenLit deployment.
	// Only meaningful when APIKeyAllowlistKnown is also true.
	//
	// In v1 the CLI cannot determine this on its own — there is no
	// path from the local hook to the org's API-key allowlist — so
	// per-vendor adapters set both fields to false and the classifier
	// falls back to the repo signal. The server-side classifier in
	// src/client/src/lib/platform/coding-agents/ may re-classify
	// authoritatively once the org has registered its keys.
	APIKeyOnAllowlist bool

	// APIKeyAllowlistKnown distinguishes "we asked and the key is not
	// on the allowlist" (true + false) from "we have no way to know
	// yet" (false). Without this flag the classifier would treat
	// "no allowlist infrastructure" the same as "key explicitly
	// rejected", which produced a regression where every session
	// ended up labelled `personal` regardless of repo origin.
	APIKeyAllowlistKnown bool

	// RepoURL is the canonical remote URL collected by internal/coding/git.
	// May be empty if the session ran outside any repo.
	RepoURL string

	// RepoAllowlist is the user's local override for "what counts as
	// my work repo". Read from OPENLIT_CODING_REPO_ALLOWLIST as a
	// comma-separated list of substring patterns. Authoritative
	// allowlists live server-side; this is just a hint the CLI
	// stamps so the dashboard can pre-classify before the server
	// re-classifies.
	RepoAllowlist []string
}

// Classify returns the work/personal/disputed/unknown classification.
//
// Design constraints:
//
//   - We must NEVER classify a session as "personal" without explicit
//     evidence of a non-work signal. "no API-key allowlist configured"
//     is NOT evidence — it's an absence of signal.
//   - "no_signal" must be distinguishable from "explicit allowlist
//     mismatch" so the dashboard can render them differently.
//   - When only one of the two signals (API key, repo origin) is
//     authoritative, we still produce the best classification that
//     signal supports rather than defaulting to "unknown".
//   - Authoritative classification happens server-side; the CLI's job
//     is to stamp the strongest signal it observed locally so the UI
//     can pre-classify before the server's allowlist is applied.
func Classify(in Inputs) Classification {
	repoMatch := matchAllowlist(in.RepoURL, in.RepoAllowlist)
	hasRepoAllowlist := len(in.RepoAllowlist) > 0
	hasRepo := in.RepoURL != ""
	keyKnown := in.APIKeyAllowlistKnown
	keyAllow := in.APIKeyAllowlistKnown && in.APIKeyOnAllowlist
	keyDeny := in.APIKeyAllowlistKnown && !in.APIKeyOnAllowlist

	// Strongest signal: both allowlists agree this is work.
	if keyAllow && repoMatch {
		return Classification{Value: "work", Reason: "api_key_allowlist+repo_origin_match"}
	}

	// API key allowlisted but no repo (running outside any git tree).
	if keyAllow && !hasRepo {
		return Classification{Value: "work", Reason: "api_key_allowlist_only"}
	}

	// Conflict: work identity on a non-allowlisted repo. This could
	// mean the engineer is running corp keys on a personal repo, OR
	// that the allowlist is simply missing entries. We do NOT classify
	// as personal here — that's the call the dispute UI exists to
	// resolve. The reason makes the conflict legible on the dashboard.
	if keyAllow && hasRepo && hasRepoAllowlist && !repoMatch {
		return Classification{Value: "unknown", Reason: "api_key_work_on_non_allowlisted_repo"}
	}

	// Personal-on-work: identity is positively NOT on the API-key
	// allowlist (and we know that because keyKnown=true), but the repo
	// is. Only meaningful when an API-key allowlist actually exists;
	// otherwise we can't make this call without false-flagging every
	// session.
	if keyDeny && repoMatch {
		return Classification{Value: "personal", Reason: "api_key_personal_on_work_repo"}
	}

	// Repo IS on allowlist and the API-key allowlist is unknown — this
	// is the common v1 case (no API-key allowlist infrastructure yet).
	// The repo signal is strong on its own: the user has explicitly
	// declared this remote as a work repo via OPENLIT_CODING_REPO_ALLOWLIST.
	if repoMatch && !keyKnown {
		return Classification{Value: "work", Reason: "repo_origin_match"}
	}

	// Repo URL exists, allowlist exists, and the URL did not match: the
	// org has explicitly declared this repo non-work. This is the
	// only branch where "personal" is safe without API-key data.
	if hasRepo && hasRepoAllowlist && !repoMatch {
		return Classification{Value: "personal", Reason: "repo_origin_no_match"}
	}

	// Nothing actionable: either no repo at all and no API key, or the
	// only signal we have is "API key allowlist is unknown" without an
	// allowlist to compare against. Don't pretend confidence.
	if !hasRepo && !keyKnown {
		return Classification{Value: "unknown", Reason: "no_signal"}
	}
	if hasRepo && !hasRepoAllowlist {
		return Classification{Value: "unknown", Reason: "no_repo_allowlist_configured"}
	}
	return Classification{Value: "unknown", Reason: "ambiguous"}
}

// matchAllowlist returns true if any allowlist substring is present in url.
// Patterns are matched case-insensitively against the bare URL.
func matchAllowlist(url string, patterns []string) bool {
	if url == "" || len(patterns) == 0 {
		return false
	}
	low := strings.ToLower(url)
	for _, p := range patterns {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" {
			continue
		}
		if strings.Contains(low, p) {
			return true
		}
	}
	return false
}

// SplitAllowlist parses the comma-separated form of OPENLIT_CODING_REPO_ALLOWLIST.
func SplitAllowlist(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
