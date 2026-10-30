package claudecode

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openlit/openlit/cli/internal/coding/pricing"
	"github.com/openlit/openlit/cli/internal/coding/tailfile"
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

// Tool results make transcripts exceed tailfile.DefaultCap quickly; usage
// before the last DefaultCap bytes (and around oversized lines) must count.
func TestTailTranscriptReadsPastTailCap(t *testing.T) {
	first := `{"type":"assistant","requestId":"req_1","message":{"id":"msg_1","model":"claude-opus-5-5","usage":{"input_tokens":100,"output_tokens":10}}}`
	filler := `{"type":"user","message":{"content":"` + strings.Repeat("x", int(tailfile.DefaultCap)+1024) + `"}}`
	last := `{"type":"assistant","requestId":"req_2","message":{"id":"msg_2","model":"claude-opus-5-5","usage":{"input_tokens":200,"output_tokens":20}}}`
	path := filepath.Join(t.TempDir(), "session.jsonl")
	if err := os.WriteFile(path, []byte(first+"\n"+filler+"\n"+last+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, in, out, _ := tailTranscript(path); in != 300 || out != 30 {
		t.Fatalf("in=%d out=%d, want 300/30", in, out)
	}
}

// Claude Code's 1-hour prompt-cache writes bill at 2x base input, not the
// 5-minute write rate.
func TestTailTranscriptPricesOneHourCacheWrites(t *testing.T) {
	line := `{"type":"assistant","requestId":"req_1","message":{"id":"msg_1","model":"claude-opus-5-5","usage":{"input_tokens":0,"cache_creation_input_tokens":1000000,"cache_read_input_tokens":0,"output_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":1000000}}}}`
	path := filepath.Join(t.TempDir(), "session.jsonl")
	if err := os.WriteFile(path, []byte(line+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, cost, _, _, _ := tailTranscript(path); cost < 7.999 || cost > 8.001 {
		t.Fatalf("cost = %v, want 8.00 (1M 1h cache-write tokens at 2x $4 input)", cost)
	}
}
