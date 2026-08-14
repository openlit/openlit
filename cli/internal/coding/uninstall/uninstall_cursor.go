// Cursor-specific uninstall path: the symmetric inverse of
// install_cursor.go.
//
// Strips every hook entry whose `command` we own out of
// ~/.cursor/hooks.json. We MUST NOT touch entries authored by other
// tools (or the user themselves), so we operate per-event and
// per-entry rather than overwriting the file. If our strip empties
// the entire `hooks` block AND nothing else of substance remains
// (a bare `version` field doesn't count), we delete the file
// outright so the user is left with a clean home directory.
//
// Idempotent: running uninstall against a machine that was never
// installed is a no-op and reports zero paths touched.

package uninstall

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// cursorOwnedCommandMarker mirrors install/install_cursor.go. Kept in
// sync by code review: both packages must agree on what "ours" means.
const cursorOwnedCommandMarker = "openlit coding hook --vendor=cursor"

// uninstallCursorHooks performs the two cleanup steps. Returns the
// absolute paths it removed or rewrote, plus any non-fatal errors.
func uninstallCursorHooks(dryRun bool) (removed []string, errs []string) {
	hooksPath, err := userCursorHooksPath()
	if err != nil {
		return nil, []string{err.Error()}
	}

	switch path, e := stripCursorHooks(hooksPath, dryRun); {
	case e != nil:
		errs = append(errs, e.Error())
	case path != "":
		removed = append(removed, path)
	}
	return removed, errs
}

// stripCursorHooks rewrites hooksPath in place to drop our entries.
// Returns the path that was modified (empty if no change was needed).
// Missing file = nothing to do, not an error.
func stripCursorHooks(hooksPath string, dryRun bool) (string, error) {
	body, err := os.ReadFile(hooksPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	if len(body) == 0 {
		return "", nil
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", fmt.Errorf("parse %s: %w (leaving the file untouched)", hooksPath, err)
	}

	hooksRaw, ok := raw["hooks"]
	if !ok {
		// No hooks block at all — nothing for us to strip.
		return "", nil
	}
	var hooks map[string][]json.RawMessage
	if err := json.Unmarshal(hooksRaw, &hooks); err != nil {
		return "", fmt.Errorf("parse hooks in %s: %w (leaving the file untouched)", hooksPath, err)
	}

	changed := false
	for event, entries := range hooks {
		kept := make([]json.RawMessage, 0, len(entries))
		for _, e := range entries {
			if isOpenLitEntry(e) {
				changed = true
				continue
			}
			kept = append(kept, e)
		}
		if len(kept) == 0 {
			delete(hooks, event)
		} else {
			hooks[event] = kept
		}
	}

	if !changed {
		return "", nil
	}

	// If our strip emptied the hooks block AND nothing else of
	// substance remains, drop the file. Otherwise re-serialize the
	// trimmed structure. We treat a lone `version` field as
	// "of no substance" — keeping the file just for that is noise.
	if len(hooks) == 0 {
		nonTrivial := false
		for k := range raw {
			if k != "hooks" && k != "version" {
				nonTrivial = true
				break
			}
		}
		if !nonTrivial {
			if dryRun {
				return hooksPath, nil
			}
			if err := os.Remove(hooksPath); err != nil {
				return hooksPath, err
			}
			return hooksPath, nil
		}
	}

	updatedHooks, err := json.Marshal(hooks)
	if err != nil {
		return "", fmt.Errorf("encode trimmed hooks: %w", err)
	}
	if len(hooks) == 0 {
		delete(raw, "hooks")
	} else {
		raw["hooks"] = updatedHooks
	}

	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return "", fmt.Errorf("encode trimmed hooks file: %w", err)
	}
	out = append(out, '\n')

	if dryRun {
		return hooksPath, nil
	}
	if err := writeFileAtomic(hooksPath, out, 0o644); err != nil {
		return hooksPath, err
	}
	return hooksPath, nil
}

// isOpenLitEntry reports whether a hook entry was authored by us.
// Mirrors install/install_cursor.go's helper of the same name.
func isOpenLitEntry(raw json.RawMessage) bool {
	var entry struct {
		Command string `json:"command"`
	}
	if err := json.Unmarshal(raw, &entry); err != nil {
		return false
	}
	return entry.Command != "" && strings.Contains(entry.Command, cursorOwnedCommandMarker)
}

func userCursorHooksPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("could not resolve home directory: %w", err)
	}
	return filepath.Join(home, ".cursor", "hooks.json"), nil
}

// writeFileAtomic writes body to path via a tempfile + rename so a
// crash mid-write can't leave a half-written hooks file in place.
func writeFileAtomic(path string, body []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".hooks.json.*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		_ = os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return err
	}
	if err := os.Chmod(name, mode); err != nil {
		_ = os.Remove(name)
		return err
	}
	return os.Rename(name, path)
}
