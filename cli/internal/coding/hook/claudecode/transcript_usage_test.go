package claudecode

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openlit/openlit/cli/internal/coding/pricing"
)

// TestTailTranscriptCountsEachMessageOnce covers the SessionEnd token
// and cost rollup. Claude Code writes one transcript line per content
// block (thinking / text / tool_use) of a single API response, and
// every one of those lines repeats the same message.id, requestId and
// usage object. The per-turn reader (coalesceAssistants) already
// collapses them; the session rollup must count the response once too.
func TestTailTranscriptCountsEachMessageOnce(t *testing.T) {
	usage := map[string]any{
		"input_tokens":                10,
		"cache_creation_input_tokens": 200,
		"cache_read_input_tokens":     1000,
		"output_tokens":               50,
	}
	var lines []string
	for _, block := range []map[string]any{
		{"type": "thinking", "thinking": "plan"},
		{"type": "text", "text": "Running the tests."},
		{"type": "tool_use", "id": "toolu_1", "name": "Bash", "input": map[string]any{"command": "go test ./..."}},
	} {
		raw, err := json.Marshal(map[string]any{
			"type":      "assistant",
			"requestId": "req_1",
			"message": map[string]any{
				"id":          "msg_1",
				"model":       "claude-sonnet-4-5",
				"content":     []any{block},
				"stop_reason": "tool_use",
				"usage":       usage,
			},
		})
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		lines = append(lines, string(raw))
	}
	path := filepath.Join(t.TempDir(), "transcript.jsonl")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatalf("write transcript: %v", err)
	}

	model, cost, in, out, total := tailTranscript(path)
	if model != "claude-sonnet-4-5" {
		t.Errorf("model = %q", model)
	}
	if in != 1210 || out != 50 || total != 1260 {
		t.Errorf("tailTranscript tokens = in %d / out %d / total %d, want 1210 / 50 / 1260 (one API response)", in, out, total)
	}
	if want := pricing.Lookup(model).Cost(1210, 50, 1000, 200); cost != want {
		t.Errorf("tailTranscript cost = %.8f, want %.8f", cost, want)
	}
}
