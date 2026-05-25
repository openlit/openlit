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
	return written, nil
}

// vendorDestRoot returns the directory under $HOME where this vendor's
// manifests must land. We honor each vendor's own conventions:
//
//   Claude Code → ~/.claude/plugins/openlit-cc/
//   Cursor      → ~/.cursor/plugins/openlit/
//   Codex       → ~/.codex/plugins/openlit/
//   Copilot CLI → ~/.copilot/plugins/openlit/
//
// These paths are documented for each vendor and don't conflict with any
// builtin/marketplace-installed plugin layouts.
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
		return filepath.Join(home, ".codex", "plugins", "openlit"), nil
	case "copilot":
		return filepath.Join(home, ".copilot", "plugins", "openlit"), nil
	default:
		return "", fmt.Errorf("unknown vendor %q", vendor)
	}
}
