// File-level scrubbers that run after the vendor-CLI based uninstall
// steps. In practice, both the Claude Code and Codex CLIs have been
// observed to leave residual openlit-owned state in their on-disk
// config files even after their advertised "uninstall" / "marketplace
// remove" subcommands run to success. The scrubbers here are
// defense in depth: surgical edits that delete only the keys / TOML
// sections openlit owns, preserve everything else, and treat the
// missing-file case as a no-op.
//
// We deliberately do not use a TOML library here — adding one for
// this single janitorial use case is more risk (line-noise diff,
// dep churn) than benefit. The stripper is line-based and section-
// aware; the test in vendor_config_scrub_test.go covers the
// interesting cases (mixed sections, nested project blocks,
// inline tables on adjacent lines).

package uninstall

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// stripClaudeMarketplaceJSON removes the `openlit` entry from
// `~/.claude/plugins/known_marketplaces.json` when present. Returns
// the file path it touched (empty string if nothing to do) and any
// error encountered. Missing file / missing key are not errors.
//
// In dry-run mode the file is left unchanged but a present openlit
// key is still reported as "would touch".
func stripClaudeMarketplaceJSON(dryRun bool) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(home, ".claude", "plugins", "known_marketplaces.json")
	raw, err := os.ReadFile(path) //nolint:gosec // path is derived from $HOME
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	// Unmarshal into a generic map so we don't have to track
	// Claude's schema. We only need to know "does the openlit
	// key exist?". The file is small (a few dozen entries at
	// most) so the round-trip cost is negligible.
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		// If the file is unparseable, leave it alone rather than
		// blow it away — user may have hand-edited it.
		return "", fmt.Errorf("parse %s: %w", path, err)
	}
	if _, ok := data["openlit"]; !ok {
		return "", nil
	}
	if dryRun {
		return path, nil
	}
	delete(data, "openlit")
	// Re-marshal with the same indentation Claude itself uses
	// (two spaces) so the diff in the user's dotfiles repo is
	// minimal.
	out, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return path, err
	}
	out = append(out, '\n')
	if err := writeFileAtomic(path, out, 0o600); err != nil {
		return path, err
	}
	return path, nil
}

// codexOpenlitSectionRe matches every TOML section header that
// openlit owns. The patterns mirror exactly what
// `install_patch.go` causes Codex to write — they are NOT a
// best-effort guess.
//
//	[marketplaces.openlit]                              ← from `codex plugin marketplace add`
//	[plugins."openlit@openlit"]                         ← from `codex plugin add openlit@openlit`
//	[hooks.state."openlit@openlit:hooks/hooks.json:*"]  ← codex caches trusted-hash per hook event
var codexOpenlitSectionRe = regexp.MustCompile(
	`^\[(?:` +
		`marketplaces\.openlit` +
		`|plugins\."openlit@openlit"` +
		`|hooks\.state\."openlit@openlit:[^"]*"` +
		`)\]\s*$`,
)

// codexAnySectionRe matches a bare `[section.name]` line. Used to
// detect the boundary that ends an openlit section we're stripping.
var codexAnySectionRe = regexp.MustCompile(`^\[[^\]]+\]\s*$`)

// stripCodexConfigTOML rewrites `~/.codex/config.toml` so that
// every openlit-owned section is removed. Other sections —
// including `[projects."/Users/.../openlit"]` (which is a user
// trust-level entry, not an openlit artifact) — are preserved
// verbatim.
//
// Returns the file path that was touched (empty string when nothing
// changed) plus any error from the read/write path. Missing file
// is a no-op.
func stripCodexConfigTOML(dryRun bool) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(home, ".codex", "config.toml")
	raw, err := os.ReadFile(path) //nolint:gosec // path is derived from $HOME
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	rewritten, changed := stripCodexOpenlitSections(string(raw))
	if !changed {
		return "", nil
	}
	if dryRun {
		return path, nil
	}
	if err := writeFileAtomic(path, []byte(rewritten), 0o600); err != nil {
		return path, err
	}
	return path, nil
}

// stripCodexOpenlitSections is the pure string transformation that
// `stripCodexConfigTOML` wraps. Split out for direct table-driven
// testing without touching the filesystem.
//
// Returns (rewritten, changed). `changed` is true iff at least one
// openlit section was removed.
func stripCodexOpenlitSections(src string) (string, bool) {
	// Preserve the original line-ending style by working on raw
	// bytes via strings.Split. CRLF inputs come through as
	// trailing \r on each split element — that's fine; we join
	// with the same separator.
	sep := "\n"
	if strings.Contains(src, "\r\n") && !strings.Contains(strings.ReplaceAll(src, "\r\n", ""), "\n") {
		sep = "\r\n"
	}
	lines := strings.Split(src, sep)

	out := make([]string, 0, len(lines))
	drop := false
	changed := false
	for _, line := range lines {
		trimmed := strings.TrimRight(line, "\r")
		if codexAnySectionRe.MatchString(trimmed) {
			if codexOpenlitSectionRe.MatchString(trimmed) {
				drop = true
				changed = true
				continue
			}
			drop = false
		}
		if drop {
			continue
		}
		out = append(out, line)
	}

	// Collapse runs of >2 blank lines that the deletions may
	// have left behind. We do it on the joined string so the
	// regex sees the actual separator boundaries.
	joined := strings.Join(out, sep)
	collapsePattern := regexp.MustCompile(`(?:` + regexp.QuoteMeta(sep) + `){3,}`)
	joined = collapsePattern.ReplaceAllString(joined, sep+sep)
	return joined, changed
}

// writeFileAtomic is shared with uninstall_cursor.go — both
// callers want the same temp-file-and-rename semantics. Defined
// there so we don't duplicate the implementation.
