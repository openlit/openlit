// Package identity resolves the canonical user identity to stamp on
// every emitted span.
//
// The hub's "Users" tab rolls up per user, so we need ONE stable
// identifier per human. Different vendors expose identity differently:
//
//   - Cursor    ships `user_email` in its hook payload.
//   - Claude Code stores it in ~/.claude.json (`oauthAccount.emailAddress`).
//   - Codex     authenticates via OAuth and stores the email inside the
//     JWT under tokens.id_token (we don't decode JWTs in v1).
//
// Without a per-vendor authoritative source we end up with two rows for
// the same human: one labeled with the OAuth email (when OPENLIT_USER
// is set) and one labeled with the OS username (the fallback in
// resolveLocalUser). This file is the single place that knows how to
// extract the email-shaped identity from each vendor's local config.
//
// Lookup order:
//  1. OPENLIT_USER (explicit override)
//  2. Per-vendor authoritative source (see ResolveForVendor)
//  3. `git config --get user.email` (cross-vendor canonical)
//  4. Caller falls through to OS username (resolveLocalUser).
//
// All functions return "" on any failure — telemetry is best-effort.
package identity

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ResolveForVendor returns the canonical user identity for `vendor` by
// reading the vendor's local OAuth/config file. Returns "" when the
// file is missing, malformed, or doesn't carry an email. The vendor
// argument is the canonical vendor id ("claude-code", "codex",
// "cursor"); unknown vendors return "".
func ResolveForVendor(vendor string) string {
	switch vendor {
	case "claude-code", "cc", "claudecode":
		return claudeCodeEmail()
	case "codex":
		return codexEmail()
	}
	return ""
}

// FromGitConfig returns `git config --get user.email` with a hard
// timeout. Returns "" on any failure (git not installed, no config
// value, slow filesystem).
func FromGitConfig() string {
	if _, err := exec.LookPath("git"); err != nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	out, err := exec.CommandContext(ctx, "git", "config", "--get", "user.email").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// claudeCodeEmail reads ~/.claude.json and returns
// `oauthAccount.emailAddress` — the same canonical identity Claude
// Code itself uses for billing and audit.
func claudeCodeEmail() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(home, ".claude.json"))
	if err != nil {
		return ""
	}
	var parsed struct {
		OAuthAccount struct {
			EmailAddress string `json:"emailAddress"`
		} `json:"oauthAccount"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return ""
	}
	return strings.TrimSpace(parsed.OAuthAccount.EmailAddress)
}

// codexEmail extracts the email from Codex's OAuth credentials at
// ~/.codex/auth.json. The email is embedded as a claim in the JWT
// id_token; we don't have a JWT verifier in the hook hot path, so we
// do a minimal claim extraction (payload-only base64url decode, no
// signature check — read-only use, never used for auth decisions).
//
// Returns "" when:
//   - the file is missing (Codex not signed in)
//   - the JSON / JWT layout doesn't match
//   - the `email` claim is empty
func codexEmail() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(home, ".codex", "auth.json"))
	if err != nil {
		return ""
	}
	var parsed struct {
		Tokens struct {
			IDToken string `json:"id_token"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return ""
	}
	return emailFromJWT(parsed.Tokens.IDToken)
}

// emailFromJWT extracts the `email` claim from a JWT payload. It does
// NOT verify the signature — we trust the file because it lives in the
// user's $HOME and is owned by their OS account. Returns "" when the
// token isn't well-formed or doesn't carry an email claim.
func emailFromJWT(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return ""
	}
	payload, err := decodeJWTSegment(parts[1])
	if err != nil {
		return ""
	}
	var claims struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}
	return strings.TrimSpace(claims.Email)
}

// decodeJWTSegment decodes a base64url-encoded JWT segment, tolerating
// missing padding (JWT spec strips the `=` chars).
func decodeJWTSegment(seg string) ([]byte, error) {
	// JWT uses base64url WITHOUT padding. We can't import encoding/base64
	// without expanding the package's dependency surface — but we already
	// have it via stdlib elsewhere. Use it directly.
	switch len(seg) % 4 {
	case 2:
		seg += "=="
	case 3:
		seg += "="
	}
	return base64URLDecode(seg)
}
