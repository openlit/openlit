// Cursor-specific install path: merge OpenLit's hook entries into the
// user-scope ~/.cursor/hooks.json file instead of dropping a separate
// plugin tree under ~/.cursor/plugins/openlit/.
//
// Why user-scope hooks.json and not the plugin dir?
//
// Cursor evaluates hooks from four scopes (Enterprise, User, Project,
// Project Claude). The plugin loader IS supposed to surface plugin
// manifests under ~/.cursor/plugins/<name>/hooks/hooks.json, but in
// practice that path requires the user to register the plugin via the
// in-app `/add-plugin` flow — silently dropping files there does NOT
// make Cursor pick them up. We confirmed this on real machines (Cursor's
// own debug log lists the four scope paths but never the plugins dir).
//
// User-scope is the documented, supported way to install agent-wide
// hooks that apply to every workspace the user opens, and it works
// without any in-app step. That's exactly what we want from
// `openlit coding install --vendor=cursor`.
//
// Multiple-owner safety:
//
// ~/.cursor/hooks.json is a shared resource — a user may already have
// hooks installed by another tool (or hand-written ones). We MUST NOT
// blow those away. Install merges per-event:
//
//   1. Read existing hooks.json (or start fresh if missing).
//   2. For each event in our embedded hooks.json, drop any prior entry
//      whose `command` we own (substring `openlit coding hook
//      --vendor=cursor`) — keeps re-install idempotent.
//   3. Append our patched entry to the event array.
//   4. Preserve all unrelated events and top-level keys.
//
// On uninstall we do the inverse strip; see uninstall_cursor.go.

package install

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// cursorOwnedCommandMarker identifies hook entries this CLI authored.
// We match on a substring of the `command` string so the marker
// survives whatever absolute path patchManifestBytes inlined.
const cursorOwnedCommandMarker = "openlit coding hook --vendor=cursor"

// installCursorHooks merges our hook entries into ~/.cursor/hooks.json.
// Returns the absolute path of the file it touched (or would touch in
// dry-run) so the install command can print it to the user.
func installCursorHooks(dryRun bool) ([]string, error) {
	openlitBin, err := resolveOpenlitBin()
	if err != nil {
		return nil, fmt.Errorf("locate openlit binary: %w (install openlit and ensure it is on PATH)", err)
	}

	hooksPath, err := userCursorHooksPath()
	if err != nil {
		return nil, err
	}

	// Load our hook template from the embedded plugin tree. We
	// rewrite the bare `openlit ...` commands to use the absolute
	// path of the running binary so GUI launches of Cursor (which
	// don't inherit the shell's PATH) still find it.
	tmplBytes, err := marketplaceFS.ReadFile("marketplace/plugins/cursor/hooks/hooks.json")
	if err != nil {
		return nil, fmt.Errorf("read embedded cursor hooks template: %w", err)
	}
	tmplBytes = patchManifestBytes("hooks/hooks.json", tmplBytes, openlitBin)
	var template cursorHooksFile
	if err := json.Unmarshal(tmplBytes, &template); err != nil {
		return nil, fmt.Errorf("parse embedded cursor hooks template: %w", err)
	}

	existing, err := readCursorHooksFile(hooksPath)
	if err != nil {
		return nil, fmt.Errorf("read existing %s: %w", hooksPath, err)
	}

	merged := mergeCursorHooks(existing, template)

	if dryRun {
		return []string{hooksPath}, nil
	}

	if err := writeCursorHooksFile(hooksPath, merged); err != nil {
		return nil, err
	}
	return []string{hooksPath}, nil
}

// cursorHooksFile mirrors the shape of ~/.cursor/hooks.json. We use
// json.RawMessage for hook-entry values so we round-trip any extra
// fields (e.g. `timeout`, future fields Cursor may add) without
// silently dropping them.
type cursorHooksFile struct {
	Version int                          `json:"version,omitempty"`
	Hooks   map[string][]json.RawMessage `json:"hooks,omitempty"`
	// Extra captures any unrecognized top-level keys so we don't
	// drop them when we re-marshal the file. encoding/json gives us
	// this only via a custom unmarshal — see below.
	Extra map[string]json.RawMessage `json:"-"`
}

func (f *cursorHooksFile) UnmarshalJSON(data []byte) error {
	raw := map[string]json.RawMessage{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if v, ok := raw["version"]; ok {
		_ = json.Unmarshal(v, &f.Version)
		delete(raw, "version")
	}
	if h, ok := raw["hooks"]; ok {
		if err := json.Unmarshal(h, &f.Hooks); err != nil {
			return fmt.Errorf("hooks: %w", err)
		}
		delete(raw, "hooks")
	}
	if len(raw) > 0 {
		f.Extra = raw
	}
	return nil
}

func (f cursorHooksFile) MarshalJSON() ([]byte, error) {
	out := map[string]json.RawMessage{}
	for k, v := range f.Extra {
		out[k] = v
	}
	if f.Version != 0 {
		v, err := json.Marshal(f.Version)
		if err != nil {
			return nil, err
		}
		out["version"] = v
	}
	if f.Hooks != nil {
		h, err := json.Marshal(f.Hooks)
		if err != nil {
			return nil, err
		}
		out["hooks"] = h
	}
	return json.Marshal(out)
}

// mergeCursorHooks returns a new cursorHooksFile with our template's
// entries merged into existing. The rules are documented at the top of
// this file. The receiver is not mutated.
func mergeCursorHooks(existing, template cursorHooksFile) cursorHooksFile {
	merged := cursorHooksFile{
		Version: existing.Version,
		Hooks:   map[string][]json.RawMessage{},
		Extra:   existing.Extra,
	}
	// Bump version to the template's if existing had none — keeps
	// fresh installs writing version:1 rather than version:0.
	if merged.Version == 0 {
		merged.Version = template.Version
	}
	for event, entries := range existing.Hooks {
		filtered := make([]json.RawMessage, 0, len(entries))
		for _, e := range entries {
			if !isOpenLitEntry(e) {
				filtered = append(filtered, e)
			}
		}
		if len(filtered) > 0 {
			merged.Hooks[event] = filtered
		}
	}
	for event, entries := range template.Hooks {
		merged.Hooks[event] = append(merged.Hooks[event], entries...)
	}
	return merged
}

// isOpenLitEntry reports whether a hook entry was authored by us. It
// runs on the raw bytes to avoid a strict struct that might choke on
// extra fields. We don't substring-match the full RawMessage because
// the marker could appear inside an unrelated string field; instead we
// shallow-decode to read `command` specifically.
func isOpenLitEntry(raw json.RawMessage) bool {
	var entry struct {
		Command string `json:"command"`
	}
	if err := json.Unmarshal(raw, &entry); err != nil {
		return false
	}
	return entry.Command != "" && strings.Contains(entry.Command, cursorOwnedCommandMarker)
}

// readCursorHooksFile returns the file's parsed contents, or an empty
// shell if the file does not exist. A malformed existing file is an
// error — we refuse to silently overwrite a user-broken JSON file.
func readCursorHooksFile(path string) (cursorHooksFile, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cursorHooksFile{}, nil
		}
		return cursorHooksFile{}, err
	}
	if len(body) == 0 {
		return cursorHooksFile{}, nil
	}
	var f cursorHooksFile
	if err := json.Unmarshal(body, &f); err != nil {
		return cursorHooksFile{}, fmt.Errorf("parse %s: %w (refusing to overwrite a malformed hooks file)", path, err)
	}
	return f, nil
}

// writeCursorHooksFile serializes f and atomically replaces the
// destination. We write to a tempfile alongside the target so a
// half-written file never becomes the active hooks config.
func writeCursorHooksFile(path string, f cursorHooksFile) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	body, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return fmt.Errorf("encode cursor hooks: %w", err)
	}
	body = append(body, '\n')

	tmp, err := os.CreateTemp(filepath.Dir(path), ".hooks.json.*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, path)
}

// userCursorHooksPath returns the absolute path to ~/.cursor/hooks.json.
// Per Cursor's docs the file lives under the user's home dir on every
// supported platform (macOS, Linux, Windows), keyed off the standard
// home-dir resolver.
func userCursorHooksPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("could not resolve home directory: %w", err)
	}
	return filepath.Join(home, ".cursor", "hooks.json"), nil
}
