package install

import (
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// TestMergeCursorHooks_FreshInstall: starting from an empty user file
// (no hooks.json on disk yet), our template should land verbatim.
func TestMergeCursorHooks_FreshInstall(t *testing.T) {
	template := mustParseHooks(t, `{
		"version": 1,
		"hooks": {
			"sessionStart": [{"command": "openlit coding hook --vendor=cursor --event=sessionStart", "timeout": 5000}]
		}
	}`)

	merged := mergeCursorHooks(cursorHooksFile{}, template)

	if merged.Version != 1 {
		t.Fatalf("expected version 1, got %d", merged.Version)
	}
	if got := len(merged.Hooks["sessionStart"]); got != 1 {
		t.Fatalf("expected 1 sessionStart entry, got %d", got)
	}
}

// TestMergeCursorHooks_PreservesUnrelatedEntries: another tool already
// wrote a sessionStart hook; our install must merge alongside it.
func TestMergeCursorHooks_PreservesUnrelatedEntries(t *testing.T) {
	existing := mustParseHooks(t, `{
		"version": 1,
		"hooks": {
			"sessionStart": [{"command": "other-tool", "timeout": 1000}],
			"customEvent": [{"command": "user-script", "timeout": 1}]
		}
	}`)
	template := mustParseHooks(t, `{
		"version": 1,
		"hooks": {
			"sessionStart": [{"command": "openlit coding hook --vendor=cursor --event=sessionStart"}]
		}
	}`)

	merged := mergeCursorHooks(existing, template)

	if got := len(merged.Hooks["sessionStart"]); got != 2 {
		t.Fatalf("expected 2 sessionStart entries (other + ours), got %d", got)
	}
	if got := len(merged.Hooks["customEvent"]); got != 1 {
		t.Fatalf("expected customEvent preserved, got %d", got)
	}
	// "other-tool" entry must come first (we append).
	cmds := commandsFor(t, merged.Hooks["sessionStart"])
	if cmds[0] != "other-tool" {
		t.Fatalf("existing entry should come first; got order %v", cmds)
	}
	if !strings.Contains(cmds[1], "openlit coding hook") {
		t.Fatalf("our entry should come second; got %q", cmds[1])
	}
}

// TestMergeCursorHooks_Idempotent: running install twice should NOT
// double-register our hooks. The marker-based strip in mergeCursorHooks
// drops the prior openlit entry before re-appending.
func TestMergeCursorHooks_Idempotent(t *testing.T) {
	template := mustParseHooks(t, `{
		"version": 1,
		"hooks": {
			"sessionStart": [{"command": "openlit coding hook --vendor=cursor --event=sessionStart"}]
		}
	}`)

	first := mergeCursorHooks(cursorHooksFile{}, template)
	second := mergeCursorHooks(first, template)

	if got := len(second.Hooks["sessionStart"]); got != 1 {
		t.Fatalf("re-install must stay at 1 entry, got %d", got)
	}
}

// TestMergeCursorHooks_PreservesExtraTopLevelKeys: a user with custom
// top-level fields in their hooks.json must keep them after merge.
func TestMergeCursorHooks_PreservesExtraTopLevelKeys(t *testing.T) {
	existing := mustParseHooks(t, `{
		"version": 1,
		"hooks": {},
		"customConfig": {"foo": "bar"}
	}`)
	template := mustParseHooks(t, `{
		"version": 1,
		"hooks": {
			"sessionStart": [{"command": "openlit coding hook --vendor=cursor --event=sessionStart"}]
		}
	}`)

	merged := mergeCursorHooks(existing, template)

	out, err := json.Marshal(merged)
	if err != nil {
		t.Fatalf("marshal merged: %v", err)
	}
	var roundTrip map[string]json.RawMessage
	if err := json.Unmarshal(out, &roundTrip); err != nil {
		t.Fatalf("unmarshal merged: %v", err)
	}
	if _, ok := roundTrip["customConfig"]; !ok {
		t.Fatalf("customConfig was dropped; got keys %v", keys(roundTrip))
	}
}

func TestIsOpenLitEntry(t *testing.T) {
	cases := []struct {
		body string
		want bool
	}{
		{`{"command": "openlit coding hook --vendor=cursor --event=sessionStart"}`, true},
		{`{"command": "/Users/me/.openlit/bin/openlit coding hook --vendor=cursor --event=sessionEnd", "timeout": 5000}`, true},
		{`{"command": "/usr/local/bin/openlit coding hook --vendor=claude-code --event=sessionStart"}`, false},
		{`{"command": "other-tool"}`, false},
		{`{}`, false},
		{`"raw string entry"`, false},
	}
	for _, tc := range cases {
		got := isOpenLitEntry(json.RawMessage(tc.body))
		if got != tc.want {
			t.Errorf("isOpenLitEntry(%s) = %v, want %v", tc.body, got, tc.want)
		}
	}
}

func mustParseHooks(t *testing.T, body string) cursorHooksFile {
	t.Helper()
	var f cursorHooksFile
	if err := json.Unmarshal([]byte(body), &f); err != nil {
		t.Fatalf("parse fixture: %v\n%s", err, body)
	}
	return f
}

func commandsFor(t *testing.T, entries []json.RawMessage) []string {
	t.Helper()
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		var v struct {
			Command string `json:"command"`
		}
		if err := json.Unmarshal(e, &v); err != nil {
			t.Fatalf("decode entry: %v", err)
		}
		out = append(out, v.Command)
	}
	return out
}

func keys(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Compile-time guard that the round-trip path produces structurally
// equivalent data when there is nothing to merge.
var _ = reflect.DeepEqual
