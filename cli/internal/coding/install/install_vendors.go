// Per-vendor manifest writers. The actual manifest contents live under
// plugins/ at the repo root and are embedded into the binary via go:embed.
// installVendor writes the appropriate subset to the user's home directory
// for each vendor.

package install

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// pluginsFS holds the host plugin manifests (one per vendor). The contents
// are mirrored from the top-level plugins/ directory at build time so the
// CLI binary is self-contained — users don't need to clone the repo to run
// `openlit coding install`.
//
// `all:` prefix is required so go:embed descends into dot-prefixed
// subdirectories (Claude Code's `.claude-plugin/`, Cursor's
// `.cursor-plugin/`, Codex's `.codex-plugin/`).
//
//go:embed all:plugins
var pluginsFS embed.FS

// installVendor writes the manifest set for one vendor to the user's
// home directory. Returns the absolute paths it touched.
func installVendor(vendor string, dryRun bool) ([]string, error) {
	dest, err := vendorDestRoot(vendor)
	if err != nil {
		return nil, err
	}
	srcDir := "plugins/" + vendor

	openlitBin, binErr := resolveOpenlitBin()
	if binErr != nil {
		return nil, fmt.Errorf("locate openlit binary: %w (install openlit and ensure it is on PATH)", binErr)
	}

	var written []string
	walkErr := fs.WalkDir(pluginsFS, srcDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel := strings.TrimPrefix(p, srcDir+"/")
		target := filepath.Join(dest, rel)
		written = append(written, target)
		if dryRun {
			return nil
		}
		body, readErr := pluginsFS.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		body = patchManifestBytes(rel, body, openlitBin)
		if mkErr := os.MkdirAll(filepath.Dir(target), 0o755); mkErr != nil {
			return mkErr
		}
		mode := fs.FileMode(0o644)
		if strings.HasSuffix(rel, ".sh") {
			mode = 0o755
		}
		return os.WriteFile(target, body, mode)
	})
	if walkErr != nil {
		// fs.ErrNotExist means we haven't authored manifests for this
		// vendor yet — surface it as an explicit not-implemented rather
		// than a confusing path error.
		if os.IsNotExist(walkErr) {
			return nil, fmt.Errorf("manifest set not bundled for vendor %q (please file an issue)", vendor)
		}
		return nil, walkErr
	}

	if !dryRun && vendor == "claude-code" {
		if err := enableClaudeCodePlugin(); err != nil {
			fmt.Fprintf(os.Stderr, "openlit install: could not register Claude Code plugin via `claude` CLI: %v\n", err)
			fmt.Fprintf(os.Stderr, "openlit install: hooks were still written to %s — in Claude Code run: /plugin marketplace add <openlit-repo>/plugins then /plugin install openlit-cc@openlit\n", dest)
		}
	}
	if !dryRun && vendor == "codex" {
		if err := enableCodexPlugin(dest); err != nil {
			fmt.Fprintf(os.Stderr, "openlit install: could not register Codex plugin via `codex` CLI: %v\n", err)
			fmt.Fprintf(os.Stderr, "openlit install: marketplace was written to %s — in Codex run: codex plugin marketplace add %s then codex plugin add openlit@openlit, then open /hooks inside Codex and trust each hook\n", dest, dest)
		}
	}
	return written, nil
}

// vendorDestRoot returns the directory under $HOME where this vendor's
// manifests must land. We honor each vendor's own conventions:
//
//   Claude Code → ~/.claude/plugins/openlit-cc/
//   Cursor      → ~/.cursor/plugins/openlit/
//   Codex       → ~/.local/share/openlit/codex-marketplace/  (a local
//                 marketplace registered via `codex plugin marketplace add`)
//   Copilot CLI → ~/.copilot/plugins/openlit/
//
// For Codex specifically: dropping files under `~/.codex/plugins/<name>/`
// is NOT how Codex's plugin loader discovers plugins. The loader scans
// configured marketplaces (`codex plugin marketplace list`) and only
// installs plugins by name via `codex plugin add <plugin>@<marketplace>`.
// We therefore materialize a self-contained marketplace tree at a
// stable location and register it via the `codex` CLI in
// enableCodexPlugin() (see install_patch.go).
func vendorDestRoot(vendor string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("could not resolve home directory: %w", err)
	}
	switch vendor {
	case "claude-code":
		return filepath.Join(home, ".claude", "plugins", "openlit-cc"), nil
	case "cursor":
		return filepath.Join(home, ".cursor", "plugins", "openlit"), nil
	case "codex":
		return filepath.Join(home, ".local", "share", "openlit", "codex-marketplace"), nil
	case "copilot":
		return filepath.Join(home, ".copilot", "plugins", "openlit"), nil
	default:
		return "", fmt.Errorf("unknown vendor %q", vendor)
	}
}
