package install

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// patchManifestBytes rewrites hook manifests so they do not depend on the
// caller's PATH. GUI apps (VS Code, Cursor) often launch hook subprocesses
// with a minimal PATH that omits ~/.local/bin. Replacing the bare
// `openlit` command with the absolute path of the binary that ran
// `openlit coding install` removes that whole class of "hooks fire but
// don't find the CLI" failures.
func patchManifestBytes(_ string, body []byte, openlitBin string) []byte {
	s := string(body)
	if strings.Contains(s, "__OPENLIT_BIN__") {
		s = strings.ReplaceAll(s, "__OPENLIT_BIN__", openlitBin)
	}
	if strings.Contains(s, "openlit coding hook") {
		quoted := shellQuote(openlitBin)
		s = strings.ReplaceAll(s, "openlit coding hook", quoted+" coding hook")
	}
	return []byte(s)
}

func resolveOpenlitBin() (string, error) {
	if exe, err := os.Executable(); err == nil {
		if filepath.Base(exe) == "openlit" {
			return exe, nil
		}
	}
	return exec.LookPath("openlit")
}

func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	if !strings.ContainsAny(s, " \t\n'\"\\$`") {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// enableClaudeCodePlugin registers the bundled marketplace and installs
// openlit-cc for the user. Best-effort when `claude` is missing.
//
// Skipping silently is only correct for "claude isn't installed on this
// machine" — everything else (missing embedded template, can't resolve
// our own binary) is a real failure that the caller surfaces via stderr.
// Swallowing those would leave the on-disk plugin orphaned because Claude
// Code only loads plugins it knows about via a marketplace, which is
// the entire point of materializing one here.
func enableClaudeCodePlugin() error {
	claudeBin, err := exec.LookPath("claude")
	if err != nil {
		return nil
	}

	openlitBin, err := resolveOpenlitBin()
	if err != nil {
		return fmt.Errorf("resolve openlit binary: %w", err)
	}
	marketplaceRoot, err := materializeClaudeMarketplace(openlitBin)
	if err != nil {
		return fmt.Errorf("materialize claude marketplace: %w", err)
	}

	add := exec.Command(claudeBin, "plugin", "marketplace", "add", marketplaceRoot) //nolint:gosec
	if out, err := add.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if msg != "" && !strings.Contains(strings.ToLower(msg), "already") {
			fmt.Fprintf(os.Stderr, "openlit install: claude marketplace add: %s\n", msg)
		}
	}

	inst := exec.Command(claudeBin, "plugin", "install", "openlit-cc@openlit", "--scope", "user") //nolint:gosec
	if out, err := inst.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if strings.Contains(strings.ToLower(msg), "already") {
			return nil
		}
		return fmt.Errorf("%s", msg)
	}
	return nil
}

// materializeClaudeMarketplace writes the embedded Claude Code
// marketplace tree to ~/.local/share/openlit/claude-marketplace so
// `claude plugin marketplace add` has a stable directory path. The
// destination layout matches the repo-root layout exactly:
//
//	~/.local/share/openlit/claude-marketplace/
//	  .claude-plugin/marketplace.json
//	  plugins/claude-code/
//	  plugins/cursor/    (carried for completeness; only claude-code is
//	  plugins/codex/      registered via `claude plugin install` below)
//
// Keeping the layout identical to repo-root means the marketplace.json's
// `source: "./plugins/claude-code"` resolves correctly for both flows
// (Claude fetching the marketplace from GitHub or from this local dir).
func materializeClaudeMarketplace(openlitBin string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	root := filepath.Join(home, ".local", "share", "openlit", "claude-marketplace")
	// Wipe a stale tree so removals in the embed (e.g. a vendor dir
	// being dropped) propagate. The marketplace dir is owned wholly
	// by us; no user data lives here.
	if err := os.RemoveAll(root); err != nil {
		return "", fmt.Errorf("clean %s: %w", root, err)
	}
	if err := extractEmbeddedDir("marketplace", root, openlitBin); err != nil {
		return "", err
	}
	return root, nil
}

// enableCodexPlugin registers the freshly written OpenLit marketplace
// with Codex and installs the `openlit@openlit` plugin so the hooks
// configured in plugin.json actually fire. Best-effort: if the `codex`
// CLI is missing we fall through with a helpful stderr note and
// expect the user to register the marketplace manually.
//
// Codex requires this two-step dance because its plugin loader does NOT
// auto-discover plugin directories — it only scans configured
// marketplaces (`codex plugin marketplace list`) and installed plugins
// (`codex plugin list`). The path `~/.codex/plugins/<name>/` is a
// red herring: nothing in Codex reads it, even if `plugin.json` and
// `hooks.json` are present there.
//
// After this call returns successfully the plugin's hooks are wired
// but Codex still requires a one-time `/hooks` review inside the TUI
// (a security measure) — we surface that requirement in the install
// command's stdout summary.
func enableCodexPlugin(marketplaceRoot string) error {
	codexBin, err := resolveCodexBin()
	if err != nil {
		return err
	}

	// 1. Register (or refresh) the marketplace. Re-running this is
	//    idempotent in newer Codex builds — older builds error with a
	//    "marketplace already exists" message that we swallow.
	add := exec.Command(codexBin, "plugin", "marketplace", "add", marketplaceRoot) //nolint:gosec
	if out, err := add.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		lower := strings.ToLower(msg)
		// "already" → idempotent add, not a real error.
		// "remote_plugin" / "feature flag" → newer builds gate the
		//    git/remote source flow, which we don't need (we pass a
		//    local path), so any other failure mode is what we want
		//    to surface.
		if msg != "" && !strings.Contains(lower, "already") {
			return fmt.Errorf("codex plugin marketplace add: %s", msg)
		}
	}

	// 2. Install the plugin from the just-added marketplace. The slug
	//    is `<plugin_name>@<marketplace_name>`, both of which come
	//    from the JSON we shipped (`name: "openlit"` in
	//    `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`).
	inst := exec.Command(codexBin, "plugin", "add", "openlit@openlit") //nolint:gosec
	if out, err := inst.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if strings.Contains(strings.ToLower(msg), "already") {
			return nil
		}
		return fmt.Errorf("codex plugin add openlit@openlit: %s", msg)
	}
	return nil
}

// resolveCodexBin finds the codex binary in $PATH, then falls back to
// the Codex.app default install location used by the macOS GUI app.
// Codex on macOS doesn't symlink itself into /usr/local/bin out of the
// box, which is why an `openlit coding install --vendor=codex` from a
// shell where `codex` isn't on $PATH would silently no-op without
// this fallback.
func resolveCodexBin() (string, error) {
	if path, err := exec.LookPath("codex"); err == nil {
		return path, nil
	}
	fallbacks := []string{
		"/Applications/Codex.app/Contents/Resources/codex",
	}
	if home, err := os.UserHomeDir(); err == nil {
		fallbacks = append(fallbacks,
			filepath.Join(home, "Applications", "Codex.app", "Contents", "Resources", "codex"),
			filepath.Join(home, ".codex", "bin", "codex"),
		)
	}
	for _, p := range fallbacks {
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p, nil
		}
	}
	return "", fmt.Errorf("codex binary not found on PATH or at the standard Codex.app location")
}

func extractEmbeddedDir(src, dest, openlitBin string) error {
	return fs.WalkDir(marketplaceFS, src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel := strings.TrimPrefix(p, src+"/")
		target := filepath.Join(dest, rel)
		body, readErr := marketplaceFS.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		body = patchManifestBytes(rel, body, openlitBin)
		if mkErr := os.MkdirAll(filepath.Dir(target), 0o755); mkErr != nil {
			return mkErr
		}
		return os.WriteFile(target, body, 0o644)
	})
}
