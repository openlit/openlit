package uninstall

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// codexConfigSample is a verbatim slice of a real
// ~/.codex/config.toml we observed in the wild. Includes every
// openlit-owned section the install path can write AND non-
// openlit content that must survive the strip pass — `[features]`,
// the user-trust `[projects."..."]` entry pointing at the openlit
// repo (which is NOT an openlit artifact, just a path that happens
// to contain the substring), unrelated marketplace + plugin
// entries, an `[mcp_servers.*]` block and its env sub-table, and
// `[hooks.state]` itself (the bare parent) which Codex regenerates
// and we must NOT strip.
const codexConfigSample = `model = "gpt-5.4"

[features]
multi_agent = true

[projects."/Users/me/private/openlit"]
trust_level = "trusted"

[marketplaces.openai-bundled]
last_updated = "2026-05-28T07:58:35Z"
source_type = "local"

[marketplaces.openlit]
last_updated = "2026-05-28T12:08:27Z"
source_type = "local"
source = "/Users/me/.local/share/openlit/codex-marketplace"

[plugins."documents@openai-primary-runtime"]
enabled = true

[plugins."openlit@openlit"]
enabled = true

[desktop]
ambient-suggestions-enabled = false

[mcp_servers.node_repl]
args = []

[mcp_servers.node_repl.env]
CODEX_HOME = "/Users/me/.codex"

[hooks.state]

[hooks.state."openlit@openlit:hooks/hooks.json:post_tool_use:0:0"]
trusted_hash = "sha256:abc"

[hooks.state."openlit@openlit:hooks/hooks.json:stop:0:0"]
trusted_hash = "sha256:def"
`

func TestStripCodexOpenlitSectionsRemovesOnlyOpenlit(t *testing.T) {
	out, changed := stripCodexOpenlitSections(codexConfigSample)
	if !changed {
		t.Fatalf("expected changed=true on a config with openlit sections")
	}

	mustNotContain := []string{
		`[marketplaces.openlit]`,
		`[plugins."openlit@openlit"]`,
		`[hooks.state."openlit@openlit:hooks/hooks.json:post_tool_use:0:0"]`,
		`[hooks.state."openlit@openlit:hooks/hooks.json:stop:0:0"]`,
		`/Users/me/.local/share/openlit/codex-marketplace`,
		`enabled = true
[desktop]`, // proxy: the plugin section's body must not survive
	}
	for _, needle := range mustNotContain {
		if strings.Contains(out, needle) {
			t.Errorf("scrubbed output should not contain %q\n--- output ---\n%s", needle, out)
		}
	}

	// Everything else must survive verbatim. Asserting on
	// specific strings is more useful than a byte-diff because
	// the test prints which line was lost.
	mustContain := []string{
		`model = "gpt-5.4"`,
		`[features]`,
		`multi_agent = true`,
		// User-trust block must NOT be confused with an openlit
		// section just because the substring "openlit" appears
		// in the path key.
		`[projects."/Users/me/private/openlit"]`,
		`trust_level = "trusted"`,
		`[marketplaces.openai-bundled]`,
		`[plugins."documents@openai-primary-runtime"]`,
		`[mcp_servers.node_repl]`,
		`[mcp_servers.node_repl.env]`,
		`CODEX_HOME = "/Users/me/.codex"`,
		// `[hooks.state]` itself (the parent) is preserved; only
		// the openlit-keyed children are dropped.
		`[hooks.state]`,
	}
	for _, needle := range mustContain {
		if !strings.Contains(out, needle) {
			t.Errorf("scrubbed output should still contain %q\n--- output ---\n%s", needle, out)
		}
	}
}

func TestStripCodexOpenlitSectionsIdempotent(t *testing.T) {
	// Two passes must yield the same string. Catches a class of
	// bug where the collapse-blank-lines pass leaves leading or
	// trailing newlines that the next run would re-collapse.
	once, _ := stripCodexOpenlitSections(codexConfigSample)
	twice, changed := stripCodexOpenlitSections(once)
	if changed {
		t.Errorf("second pass on already-scrubbed input should report changed=false")
	}
	if once != twice {
		t.Errorf("strip is not idempotent\n--- first ---\n%s\n--- second ---\n%s", once, twice)
	}
}

func TestStripCodexOpenlitSectionsNoChange(t *testing.T) {
	// A config that never had openlit in it must come out byte-
	// for-byte identical, with changed=false.
	clean := `model = "gpt-5"
[features]
multi_agent = true
`
	out, changed := stripCodexOpenlitSections(clean)
	if changed {
		t.Errorf("expected changed=false on clean input")
	}
	if out != clean {
		t.Errorf("expected output to equal input verbatim\n--- got ---\n%s", out)
	}
}

func TestStripClaudeMarketplaceJSONRemovesOpenlit(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)

	pluginDir := filepath.Join(dir, ".claude", "plugins")
	if err := os.MkdirAll(pluginDir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	path := filepath.Join(pluginDir, "known_marketplaces.json")
	initial := map[string]any{
		"claude-plugins-official": map[string]any{
			"source": map[string]any{
				"source": "github",
				"repo":   "anthropics/claude-plugins-official",
			},
			"installLocation": "/Users/me/.claude/plugins/marketplaces/claude-plugins-official",
			"lastUpdated":     "2026-05-29T06:53:57.733Z",
		},
		"openlit": map[string]any{
			"source": map[string]any{
				"source": "directory",
				"path":   "/Users/me/.local/share/openlit/claude-marketplace",
			},
			"installLocation": "/Users/me/.local/share/openlit/claude-marketplace",
			"lastUpdated":     "2026-05-28T09:43:10.432Z",
		},
	}
	mustJSONWrite(t, path, initial)

	touched, err := stripClaudeMarketplaceJSON(false)
	if err != nil {
		t.Fatalf("strip: %v", err)
	}
	if touched != path {
		t.Errorf("touched = %q, want %q", touched, path)
	}

	got := mustJSONRead(t, path)
	if _, ok := got["openlit"]; ok {
		t.Errorf("openlit entry should have been removed; got %#v", got)
	}
	if _, ok := got["claude-plugins-official"]; !ok {
		t.Errorf("claude-plugins-official entry must survive; got %#v", got)
	}
}

func TestStripClaudeMarketplaceJSONNoEntry(t *testing.T) {
	// File present, no openlit key — must NOT rewrite the file
	// (and therefore must report touched="").
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	pluginDir := filepath.Join(dir, ".claude", "plugins")
	if err := os.MkdirAll(pluginDir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	path := filepath.Join(pluginDir, "known_marketplaces.json")
	mustJSONWrite(t, path, map[string]any{
		"claude-plugins-official": map[string]any{"installLocation": "/x"},
	})
	before, _ := os.ReadFile(path)

	touched, err := stripClaudeMarketplaceJSON(false)
	if err != nil {
		t.Fatalf("strip: %v", err)
	}
	if touched != "" {
		t.Errorf("touched should be empty when no openlit key; got %q", touched)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Errorf("file content must be unchanged when no openlit key present")
	}
}

func TestStripClaudeMarketplaceJSONMissingFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	touched, err := stripClaudeMarketplaceJSON(false)
	if err != nil {
		t.Errorf("missing file should be a no-op, got error: %v", err)
	}
	if touched != "" {
		t.Errorf("touched should be empty for missing file; got %q", touched)
	}
}

func TestStripClaudeMarketplaceJSONDryRun(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	pluginDir := filepath.Join(dir, ".claude", "plugins")
	if err := os.MkdirAll(pluginDir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	path := filepath.Join(pluginDir, "known_marketplaces.json")
	mustJSONWrite(t, path, map[string]any{
		"openlit": map[string]any{"installLocation": "/x"},
	})
	before, _ := os.ReadFile(path)

	touched, err := stripClaudeMarketplaceJSON(true)
	if err != nil {
		t.Fatalf("strip dry-run: %v", err)
	}
	if touched != path {
		t.Errorf("dry-run should still report which file it would touch; got %q", touched)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Errorf("dry-run must NOT modify the file")
	}
}

// --- helpers ----------------------------------------------------

func mustJSONWrite(t *testing.T, path string, v any) {
	t.Helper()
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(path, append(raw, '\n'), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func mustJSONRead(t *testing.T, path string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}
