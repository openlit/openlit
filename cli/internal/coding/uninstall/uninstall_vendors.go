// Per-vendor uninstall logic. Each vendor's section is the inverse of
// the corresponding installVendor / enable<Vendor>Plugin pair in
// internal/coding/install.

package uninstall

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// uninstallVendor removes the host plugin manifest set for one vendor
// and, where the vendor exposes a CLI to manage plugins (Claude Code,
// Codex), best-effort deregisters the plugin so the agent's own state
// stays consistent.
//
// Returns the absolute paths it touched plus a list of non-fatal
// errors. Side-channel CLI failures (e.g. `claude` not on PATH, codex
// returning "plugin not installed") are collected and returned rather
// than propagated as a hard error: directory cleanup is the
// authoritative state, and we don't want a missing vendor CLI to
// block the user's "I want this gone" flow.
func uninstallVendor(vendor string, dryRun bool) (removed []string, errs []string) {
	// Cursor lives in a shared user-scope file (~/.cursor/hooks.json)
	// rather than a vendor-owned directory, so it gets its own
	// path-aware stripper (see uninstall_cursor.go) that preserves
	// other tools' entries.
	if vendor == "cursor" {
		return uninstallCursorHooks(dryRun)
	}

	dest, err := vendorDestRoot(vendor)
	if err != nil {
		return nil, []string{err.Error()}
	}

	primary, primaryErr := removePath(dest, dryRun)
	if primary != "" {
		removed = append(removed, primary)
	}
	if primaryErr != nil {
		errs = append(errs, primaryErr.Error())
	}

	switch vendor {
	case "claude-code":
		// Four side effects beyond the manifest directory:
		//   1. ~/.local/share/openlit/claude-marketplace/ — written
		//      by materializeClaudeMarketplace so `claude plugin
		//      marketplace add` had a stable path. Removing the
		//      tree here means a future re-install rebuilds it
		//      from the embedded FS, which is cheap.
		//   2. ~/.claude/plugins/cache/openlit/openlit-cc/ — Claude
		//      Code's own per-version download cache. Without this
		//      sweep, a re-install + version bump leaves the
		//      previous version's binary on disk forever (Claude
		//      Code does not GC stale plugin payloads).
		//   3. `claude plugin uninstall openlit-cc@openlit` + the
		//      marketplace-remove counterpart — best-effort. If
		//      the user already removed it from inside the Claude
		//      TUI we'll get an "already uninstalled" style error
		//      and continue.
		//   4. JSON-level fallback: strip the "openlit" entry
		//      from ~/.claude/plugins/known_marketplaces.json.
		//      `claude plugin marketplace remove` does not always
		//      clear this file in practice (observed across
		//      multiple Claude Code builds), and leaving it
		//      behind causes a re-install to silently use the
		//      stale `installLocation` field.
		mp, mpErr := claudeMarketplaceRoot()
		if mpErr == nil {
			p, e := removePath(mp, dryRun)
			if p != "" {
				removed = append(removed, p)
			}
			if e != nil {
				errs = append(errs, e.Error())
			}
		}
		if cache, cacheErr := claudePluginCacheRoot(); cacheErr == nil {
			p, e := removePath(cache, dryRun)
			if p != "" {
				removed = append(removed, p)
			}
			if e != nil {
				errs = append(errs, e.Error())
			}
		}
		if !dryRun {
			if e := disableClaudeCodePlugin(); e != nil {
				errs = append(errs, e.Error())
			}
		}
		if touched, e := stripClaudeMarketplaceJSON(dryRun); touched != "" {
			removed = append(removed, touched+" (openlit entry)")
			if e != nil {
				errs = append(errs, e.Error())
			}
		}
	case "codex":
		// Codex stores the marketplace AS the plugin dest dir
		// (see vendorDestRoot), so the directory removal above
		// also removes the marketplace tree. We still need to:
		//   1. Tell Codex to forget about it via the CLI so its
		//      `codex plugin marketplace list` state matches reality.
		//   2. TOML-level fallback: strip [marketplaces.openlit],
		//      [plugins."openlit@openlit"], and every
		//      [hooks.state."openlit@openlit:*"] section from
		//      ~/.codex/config.toml. Codex's own `plugin remove`
		//      and `plugin marketplace remove` subcommands have
		//      been observed to leave these sections in place
		//      (with `enabled = true` on the plugin block!), so
		//      we go straight to the source of truth on disk.
		if !dryRun {
			if e := disableCodexPlugin(); e != nil {
				errs = append(errs, e.Error())
			}
		}
		if touched, e := stripCodexConfigTOML(dryRun); touched != "" {
			removed = append(removed, touched+" (openlit sections)")
			if e != nil {
				errs = append(errs, e.Error())
			}
		}
	}
	return removed, errs
}

// purgeShared removes the cross-vendor OpenLit state. Triggered by
// `--purge`; left out by default so re-onboarding doesn't require
// re-entering the API key / endpoint.
func purgeShared(dryRun bool) (removed []string, errs []string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, []string{err.Error()}
	}

	// 1. ~/.config/openlit/ — `openlit configure` output. We
	//    intentionally remove the whole directory rather than just
	//    config.env so any future managed-config side files
	//    (audit logs, key cache, …) are swept up by the same flag.
	configDir := filepath.Join(home, ".config", "openlit")
	if p, e := removePath(configDir, dryRun); p != "" {
		removed = append(removed, p)
		if e != nil {
			errs = append(errs, e.Error())
		}
	}

	// 2. <UserCacheDir>/openlit/ — session-state cache. Path
	//    resolution matches the sessionstate package so we don't
	//    drift if XDG_CACHE_HOME is set.
	if cacheRoot, err := os.UserCacheDir(); err == nil && cacheRoot != "" {
		openlitCache := filepath.Join(cacheRoot, "openlit")
		if p, e := removePath(openlitCache, dryRun); p != "" {
			removed = append(removed, p)
			if e != nil {
				errs = append(errs, e.Error())
			}
		}
	}
	return removed, errs
}

// vendorDestRoot mirrors install.vendorDestRoot for the vendors that
// own a directory. Cursor is handled separately (it merges into a
// shared hooks.json) and intentionally does not have an entry here.
// Kept as a private helper to avoid importing the install package
// (which would create a circular-import risk if install later grows
// test helpers that pull uninstall in).
func vendorDestRoot(vendor string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("could not resolve home directory: %w", err)
	}
	switch vendor {
	case "claude-code":
		return filepath.Join(home, ".claude", "plugins", "openlit-cc"), nil
	case "codex":
		return filepath.Join(home, ".local", "share", "openlit", "codex-marketplace"), nil
	default:
		return "", fmt.Errorf("unknown vendor %q", vendor)
	}
}

func claudeMarketplaceRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".local", "share", "openlit", "claude-marketplace"), nil
}

// claudePluginCacheRoot is where Claude Code unpacks the actual
// plugin payload it downloaded from a marketplace. The path is
// `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, and
// Claude does not GC stale versions on its own; if we don't sweep
// this on uninstall, a user who reinstalls with a new version will
// leave the old payload (and the matching CLAUDE_PLUGIN_ROOT-shaped
// directory) on disk indefinitely. The marketplace key matches the
// `id` field of `~/.local/share/openlit/claude-marketplace/.claude-plugin/marketplace.json`.
func claudePluginCacheRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".claude", "plugins", "cache", "openlit", "openlit-cc"), nil
}

// removePath removes a file or directory tree at p. Returns the path
// (only when it existed pre-removal) and any error from the removal
// itself. A missing path is not an error: a fresh machine has no
// installation to undo and shouldn't see a spurious "not found".
func removePath(p string, dryRun bool) (string, error) {
	if p == "" {
		return "", nil
	}
	if _, err := os.Stat(p); err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	if dryRun {
		return p, nil
	}
	if err := os.RemoveAll(p); err != nil {
		return p, err
	}
	return p, nil
}

// disableClaudeCodePlugin asks the `claude` CLI to drop the openlit-cc
// plugin AND the openlit marketplace registration. Both are
// best-effort: a missing CLI or a "nothing to do" outcome is
// collapsed to nil so we don't block the directory cleanup that
// already ran. The JSON-level fallback in stripClaudeMarketplaceJSON
// is what makes uninstall actually reliable when this CLI path is
// silently incomplete.
func disableClaudeCodePlugin() error {
	claudeBin, err := exec.LookPath("claude")
	if err != nil {
		return nil
	}
	// 1) Plugin uninstall. Arg shape mirrors the install side
	//    (`plugin install openlit-cc@openlit --scope user`),
	//    inverted. If Claude renames the subcommand we swallow
	//    the error rather than fail the directory cleanup.
	rm := exec.Command(claudeBin, "plugin", "uninstall", "openlit-cc@openlit", "--scope", "user") //nolint:gosec
	if out, err := rm.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		lower := strings.ToLower(msg)
		if msg != "" &&
			!strings.Contains(lower, "not installed") &&
			!strings.Contains(lower, "not found") &&
			!strings.Contains(lower, "no such plugin") {
			return fmt.Errorf("claude plugin uninstall: %s", msg)
		}
	}
	// 2) Marketplace remove. The install side ran `claude plugin
	//    marketplace add <path>` to register openlit; this is its
	//    inverse. The bare "openlit" key matches the marketplace
	//    `name` field in our claude-marketplace.json.
	mp := exec.Command(claudeBin, "plugin", "marketplace", "remove", "openlit") //nolint:gosec
	if out, err := mp.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		lower := strings.ToLower(msg)
		if msg != "" &&
			!strings.Contains(lower, "not registered") &&
			!strings.Contains(lower, "not found") &&
			!strings.Contains(lower, "no such marketplace") {
			return fmt.Errorf("claude plugin marketplace remove openlit: %s", msg)
		}
	}
	return nil
}

// disableCodexPlugin tells the `codex` CLI to remove the openlit plugin
// and then forget the openlit marketplace registration. Both are
// best-effort and treat "already gone" as success.
func disableCodexPlugin() error {
	codexBin, err := exec.LookPath("codex")
	if err != nil {
		return nil
	}

	rm := exec.Command(codexBin, "plugin", "remove", "openlit@openlit") //nolint:gosec
	if out, err := rm.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		lower := strings.ToLower(msg)
		if msg != "" &&
			!strings.Contains(lower, "not installed") &&
			!strings.Contains(lower, "not found") &&
			!strings.Contains(lower, "no such plugin") {
			return fmt.Errorf("codex plugin remove openlit@openlit: %s", msg)
		}
	}

	mp := exec.Command(codexBin, "plugin", "marketplace", "remove", "openlit") //nolint:gosec
	if out, err := mp.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		lower := strings.ToLower(msg)
		if msg != "" &&
			!strings.Contains(lower, "not registered") &&
			!strings.Contains(lower, "not found") &&
			!strings.Contains(lower, "no such marketplace") {
			return fmt.Errorf("codex plugin marketplace remove openlit: %s", msg)
		}
	}
	return nil
}
