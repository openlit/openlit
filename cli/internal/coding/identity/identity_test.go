package identity

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveForVendor_ClaudeCodeReadsOAuthEmail(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	const wantEmail = "ishan.jain@grafana.com"
	body := `{"oauthAccount":{"accountUuid":"abc","emailAddress":"` + wantEmail + `"}}`
	if err := os.WriteFile(filepath.Join(tmp, ".claude.json"), []byte(body), 0o600); err != nil {
		t.Fatalf("write .claude.json: %v", err)
	}

	if got := ResolveForVendor("claude-code"); got != wantEmail {
		t.Fatalf("claude-code email mismatch: want=%q got=%q", wantEmail, got)
	}
	// Aliases must resolve to the same email.
	if got := ResolveForVendor("cc"); got != wantEmail {
		t.Fatalf("cc alias mismatch: want=%q got=%q", wantEmail, got)
	}
}

func TestResolveForVendor_MissingFileReturnsEmpty(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	if got := ResolveForVendor("claude-code"); got != "" {
		t.Fatalf("expected empty when ~/.claude.json missing, got %q", got)
	}
	if got := ResolveForVendor("codex"); got != "" {
		t.Fatalf("expected empty when ~/.codex/auth.json missing, got %q", got)
	}
}

func TestResolveForVendor_MalformedJSONReturnsEmpty(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	if err := os.WriteFile(filepath.Join(tmp, ".claude.json"), []byte("{ not-json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := ResolveForVendor("claude-code"); got != "" {
		t.Fatalf("malformed json must yield empty, got %q", got)
	}
}

func TestResolveForVendor_CodexExtractsEmailFromJWT(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	if err := os.MkdirAll(filepath.Join(tmp, ".codex"), 0o700); err != nil {
		t.Fatal(err)
	}
	// Pre-built JWT with payload {"email":"jwt@example.com","sub":"x"}. The
	// header + signature segments are arbitrary; we never verify them.
	const jwt = "eyJhbGciOiJIUzI1NiJ9." +
		"eyJlbWFpbCI6Imp3dEBleGFtcGxlLmNvbSIsInN1YiI6IngifQ." +
		"sig"
	body := `{"tokens":{"id_token":"` + jwt + `"}}`
	if err := os.WriteFile(filepath.Join(tmp, ".codex", "auth.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := ResolveForVendor("codex"); got != "jwt@example.com" {
		t.Fatalf("codex jwt email mismatch: got %q", got)
	}
}

func TestResolveForVendor_UnknownVendorReturnsEmpty(t *testing.T) {
	if got := ResolveForVendor("rovo"); got != "" {
		t.Fatalf("unknown vendor must yield empty, got %q", got)
	}
	if got := ResolveForVendor(""); got != "" {
		t.Fatalf("empty vendor must yield empty, got %q", got)
	}
}
