package uninstall

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestStripCursorHooks_RemovesOnlyOurs(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hooks.json")
	body := `{
		"version": 1,
		"hooks": {
			"sessionStart": [
				{"command": "other-tool"},
				{"command": "/Users/me/.openlit/bin/openlit coding hook --vendor=cursor --event=sessionStart", "timeout": 5000}
			],
			"customEvent": [{"command": "user-script"}]
		}
	}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	removed, err := stripCursorHooks(path, false)
	if err != nil {
		t.Fatalf("strip: %v", err)
	}
	if removed != path {
		t.Fatalf("removed = %q want %q", removed, path)
	}

	out, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Hooks map[string][]map[string]any `json:"hooks"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("parse rewrite: %v\n%s", err, out)
	}
	if got := len(parsed.Hooks["sessionStart"]); got != 1 {
		t.Fatalf("expected 1 sessionStart left (other-tool); got %d (%v)", got, parsed.Hooks["sessionStart"])
	}
	if parsed.Hooks["sessionStart"][0]["command"] != "other-tool" {
		t.Fatalf("wrong entry survived: %v", parsed.Hooks["sessionStart"][0])
	}
	if got := len(parsed.Hooks["customEvent"]); got != 1 {
		t.Fatalf("customEvent should be intact; got %d", got)
	}
}

func TestStripCursorHooks_DeletesFileWhenOnlyOursAndVersion(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hooks.json")
	body := `{
		"version": 1,
		"hooks": {
			"sessionStart": [
				{"command": "openlit coding hook --vendor=cursor --event=sessionStart"}
			]
		}
	}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := stripCursorHooks(path, false); err != nil {
		t.Fatalf("strip: %v", err)
	}

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("hooks.json should be deleted, but Stat returned err=%v", err)
	}
}

func TestStripCursorHooks_KeepsFileWhenOtherTopLevelKeysExist(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hooks.json")
	body := `{
		"version": 1,
		"hooks": {"sessionStart": [{"command": "openlit coding hook --vendor=cursor --event=sessionStart"}]},
		"someCustomThing": {"foo": "bar"}
	}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := stripCursorHooks(path, false); err != nil {
		t.Fatalf("strip: %v", err)
	}

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("file should still exist (someCustomThing present): %v", err)
	}
	out, _ := os.ReadFile(path)
	var raw map[string]any
	if err := json.Unmarshal(out, &raw); err != nil {
		t.Fatalf("parse: %v\n%s", err, out)
	}
	if _, ok := raw["someCustomThing"]; !ok {
		t.Fatalf("someCustomThing must be preserved; got %v", raw)
	}
}

func TestStripCursorHooks_MissingFileIsNoOp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hooks.json")
	removed, err := stripCursorHooks(path, false)
	if err != nil {
		t.Fatalf("strip: %v", err)
	}
	if removed != "" {
		t.Fatalf("removed = %q want empty", removed)
	}
}

func TestStripCursorHooks_NoOpWhenNothingOurs(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hooks.json")
	body := `{
		"version": 1,
		"hooks": {
			"sessionStart": [{"command": "other-tool"}]
		}
	}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	mtimeBefore, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}

	removed, err := stripCursorHooks(path, false)
	if err != nil {
		t.Fatalf("strip: %v", err)
	}
	if removed != "" {
		t.Fatalf("nothing of ours present, but strip reported %q", removed)
	}
	mtimeAfter, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !mtimeBefore.ModTime().Equal(mtimeAfter.ModTime()) {
		t.Fatalf("file should not have been touched")
	}
}
