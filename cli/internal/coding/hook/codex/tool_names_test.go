package codex

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/coding/sessionstate"
)

// Codex serialises hook payloads with the canonical tool names from
// codex-rs/core/src/tools/hook_names.rs: shell commands (exec_command /
// unified exec) are `Bash` with `tool_input: {"command": "<string>"}`,
// and file edits are `apply_patch` with the raw patch text in
// `tool_input.command` (codex-rs/core/src/tools/handlers/apply_patch.rs).
// See also the PostToolUse input schema in
// codex-rs/hooks/schema/generated/post-tool-use.command.input.schema.json.
func codexPostToolUse(t *testing.T, em *recordingEmitter, capture string, payload map[string]any) {
	t.Helper()
	payload["hook_event_name"] = "PostToolUse"
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("payload marshal: %v", err)
	}
	if err := handle(context.Background(), normalize.Input{
		Vendor:         "codex",
		Event:          "PostToolUse",
		Payload:        body,
		ContentCapture: capture,
		Emit:           em,
	}); err != nil {
		t.Fatalf("PostToolUse: %v", err)
	}
}

func TestCodexApplyPatchCommandInputCountsLines(t *testing.T) {
	withIsolatedCache(t)
	em := &recordingEmitter{}

	patch := "*** Begin Patch\n" +
		"*** Update File: internal/foo.go\n" +
		"@@\n" +
		"-old line\n" +
		"+new line\n" +
		"+another line\n" +
		"*** End Patch\n"
	codexPostToolUse(t, em, "metadata_only", map[string]any{
		"session_id":    "cdx-patch",
		"turn_id":       "turn-1",
		"cwd":           "/tmp/work",
		"model":         "gpt-5.5",
		"tool_name":     "apply_patch",
		"tool_use_id":   "call_patch",
		"tool_input":    map[string]any{"command": patch},
		"tool_response": "Success. Updated the following files:\nM internal/foo.go\n",
	})

	if len(em.editDecisions) != 1 {
		t.Fatalf("expected 1 edit decision for apply_patch, got %d", len(em.editDecisions))
	}
	d := em.editDecisions[0]
	if d.FilePath != "internal/foo.go" || d.LinesAdded != 2 || d.LinesRemoved != 1 {
		t.Errorf("edit decision = %+v, want internal/foo.go +2 -1", d)
	}
	st := sessionstate.Load("cdx-patch", "codex")
	if st == nil || st.LinesAdded != 2 || st.LinesRemoved != 1 {
		t.Errorf("session LOC counters not bumped: %+v", st)
	}
}

func TestCodexBashToolDetectsGitCommit(t *testing.T) {
	withIsolatedCache(t)
	em := &recordingEmitter{}

	codexPostToolUse(t, em, "metadata_only", map[string]any{
		"session_id":    "cdx-bash",
		"turn_id":       "turn-1",
		"cwd":           "/tmp/work",
		"model":         "gpt-5.5",
		"tool_name":     "Bash",
		"tool_use_id":   "call_bash",
		"tool_input":    map[string]any{"command": "git commit -m 'fix: handle nil config'"},
		"tool_response": "[main 1a2b3c4] fix: handle nil config\n 1 file changed, 2 insertions(+)\n",
	})

	if len(em.toolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(em.toolCalls))
	}
	if got := em.toolCalls[0].Command; got != "git" {
		t.Errorf("metadata_only Bash command head = %q, want %q", got, "git")
	}
	if len(em.gitCommits) != 1 {
		t.Fatalf("expected Bash `git commit` to emit 1 git commit span, got %d", len(em.gitCommits))
	}
	if em.gitCommits[0].SHA != "1a2b3c4" {
		t.Errorf("commit SHA = %q, want 1a2b3c4", em.gitCommits[0].SHA)
	}
	if em.gitCommits[0].Message != "" {
		t.Errorf("metadata_only leaked commit message %q", em.gitCommits[0].Message)
	}
}

func TestCodexBashCommandHeadSkipsEnvAssignments(t *testing.T) {
	withIsolatedCache(t)
	em := &recordingEmitter{}

	codexPostToolUse(t, em, "metadata_only", map[string]any{
		"session_id":    "cdx-env",
		"turn_id":       "turn-1",
		"cwd":           "/tmp/work",
		"model":         "gpt-5.5",
		"tool_name":     "Bash",
		"tool_use_id":   "call_env",
		"tool_input":    map[string]any{"command": "PGPASSWORD=example-secret psql -h db -c 'select 1'"},
		"tool_response": " ?column?\n----------\n        1\n",
	})

	if len(em.toolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(em.toolCalls))
	}
	// Outside full capture only the program name is recorded, and a
	// leading NAME=value assignment is not the program.
	if got := em.toolCalls[0].Command; got != "psql" {
		t.Errorf("metadata_only Bash command head = %q, want %q", got, "psql")
	}
}
