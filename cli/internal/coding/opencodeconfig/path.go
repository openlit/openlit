// Package opencodeconfig resolves OpenCode's global plugin location.
package opencodeconfig

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// PluginPath resolves the user-scoped OpenLit plugin path. OpenCode follows
// XDG_CONFIG_HOME when it is set and otherwise uses ~/.config.
func PluginPath() (string, error) {
	xdgConfigHome := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME"))
	if xdgConfigHome != "" {
		return PluginPathAt("", xdgConfigHome), nil
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("could not resolve home directory: %w", err)
	}
	return PluginPathAt(home, ""), nil
}

// PluginPathAt is the deterministic form used by installers and tests.
func PluginPathAt(home, xdgConfigHome string) string {
	root := strings.TrimSpace(xdgConfigHome)
	if root == "" {
		root = filepath.Join(home, ".config")
	}
	return filepath.Join(root, "opencode", "plugins", "openlit.ts")
}
