package hook

import (
	"os"
	"testing"
)

// TestIsClaudeCodeVendor covers the small whitelist that drives the
// host-mismatch guard's left-hand side. The list is small but the
// downstream behaviour (emit vs. drop) is binary, so we want a
// regression test for the spellings actually shipped on plugin
// manifests today.
func TestIsClaudeCodeVendor(t *testing.T) {
	cases := []struct {
		vendor string
		want   bool
	}{
		{"cc", true},
		{"CC", true},
		{"  cc  ", true},
		{"claude-code", true},
		{"Claude-Code", true},
		{"claudecode", true},
		{"cursor", false},
		{"codex", false},
		{"", false},
		{"cc-cursor", false},
	}
	for _, tc := range cases {
		t.Run(tc.vendor, func(t *testing.T) {
			if got := isClaudeCodeVendor(tc.vendor); got != tc.want {
				t.Fatalf("isClaudeCodeVendor(%q) = %v, want %v", tc.vendor, got, tc.want)
			}
		})
	}
}

// TestIsRealClaudeCodeInvocation pins down the rule that drives the
// host-mismatch guard's right-hand side: only `CLAUDECODE=1` is
// authoritative. Cursor 3.4+ honours the Claude Code plugin spec and
// fires our --vendor=cc hook for Cursor's own agent turns, mirroring
// Anthropic's `CLAUDE_*` env envelope but NOT setting `CLAUDECODE=1`
// — the env captured here matches a real production masquerade.
//
// Reverting the rule (e.g. accepting `CLAUDE_PROJECT_DIR` as a
// positive marker) reintroduces duplicate sessions on the Coding
// Agents UI; this test is the trip-wire.
func TestIsRealClaudeCodeInvocation(t *testing.T) {
	// Variables we touch across cases. We snapshot+restore them per
	// test so the suite remains hermetic when run with -run or in
	// parallel-discovery mode.
	managed := []string{
		"CLAUDECODE",
		"CLAUDE_PROJECT_DIR",
		"CLAUDE_PLUGIN_ROOT",
		"CLAUDE_SESSION_ID",
		"CURSOR_VERSION",
		"CURSOR_PLUGIN_ROOT",
		"CURSOR_USER_EMAIL",
		"CURSOR_LAYOUT",
		"CURSOR_EXTENSION_HOST_ROLE",
		"VSCODE_IPC_HOOK",
	}

	cases := []struct {
		name string
		env  map[string]string
		want bool
	}{
		{
			name: "real_claude_code_minimal",
			env: map[string]string{
				"CLAUDECODE": "1",
			},
			want: true,
		},
		{
			name: "real_claude_code_full_envelope",
			env: map[string]string{
				"CLAUDECODE":         "1",
				"CLAUDE_PROJECT_DIR": "/Users/me/repo",
				"CLAUDE_PLUGIN_ROOT": "/Users/me/.claude/plugins/cache/openlit/openlit-cc/0.1.0",
				"CLAUDE_SESSION_ID":  "8f3a...",
			},
			want: true,
		},
		{
			name: "real_claude_code_inside_cursor_terminal",
			env: map[string]string{
				// User opens a Cursor terminal and runs `claude`.
				// The shell inherits CURSOR_* from the IDE but
				// claude itself still sets CLAUDECODE=1. The
				// guard must let this through.
				"CLAUDECODE":      "1",
				"CURSOR_VERSION":  "3.4.17",
				"VSCODE_IPC_HOOK": "/Users/me/Library/Application Support/Cursor/3.4.-main.sock",
			},
			want: true,
		},
		{
			name: "cursor_compat_shim_masquerade",
			env: map[string]string{
				// Captured verbatim from Cursor 3.4.17 invoking
				// our cc hook through its compat shim. Note the
				// absence of CLAUDECODE=1 — that's the single
				// signal we anchor on.
				"CLAUDE_PROJECT_DIR":         "/Users/me/repo",
				"CLAUDE_PLUGIN_ROOT":         "/Users/me/.claude/plugins/cache/openlit/openlit-cc/0.1.0",
				"CURSOR_VERSION":             "3.4.17",
				"CURSOR_PLUGIN_ROOT":         "/Users/me/.claude/plugins/cache/openlit/openlit-cc/0.1.0",
				"CURSOR_USER_EMAIL":          "user@example.com",
				"CURSOR_LAYOUT":              "unifiedAgent",
				"CURSOR_EXTENSION_HOST_ROLE": "always-local",
				"VSCODE_IPC_HOOK":            "/Users/me/Library/Application Support/Cursor/3.4.-main.sock",
			},
			want: false,
		},
		{
			name: "claude_project_dir_alone_is_not_enough",
			env: map[string]string{
				// Pre-fix the guard treated this as positive,
				// which is what let the masquerade through.
				"CLAUDE_PROJECT_DIR": "/Users/me/repo",
			},
			want: false,
		},
		{
			name: "empty_env",
			env:  map[string]string{},
			want: false,
		},
		{
			name: "claudecode_zero_is_not_one",
			env:  map[string]string{"CLAUDECODE": "0"},
			want: false,
		},
		{
			name: "claudecode_whitespace_only_is_not_one",
			env:  map[string]string{"CLAUDECODE": "  "},
			want: false,
		},
		{
			name: "claudecode_with_padding_is_accepted",
			// TrimSpace exists so users sourcing env from a file
			// with stray whitespace don't fail-closed silently.
			env:  map[string]string{"CLAUDECODE": " 1 "},
			want: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, k := range managed {
				// t.Setenv handles restoration on test exit.
				// We Setenv first so the cleanup hook is
				// registered, then Unsetenv to give the guard
				// strict-absence semantics during the test.
				t.Setenv(k, "")
				if err := os.Unsetenv(k); err != nil {
					t.Fatalf("unset %s: %v", k, err)
				}
			}
			for k, v := range tc.env {
				t.Setenv(k, v)
			}
			if got := isRealClaudeCodeInvocation(); got != tc.want {
				t.Fatalf("isRealClaudeCodeInvocation() = %v, want %v (env=%v)", got, tc.want, tc.env)
			}
		})
	}
}
