package tailfile

import (
	"encoding/json"
	"errors"
	"io"
	"runtime"
	"strings"
	"testing"
	"testing/iotest"
)

var keep = []string{"type", "requestId", "message.id", "message.model", "message.usage"}

func collect(t *testing.T, src io.Reader) ([]map[string]any, error) {
	t.Helper()
	var got []map[string]any
	err := eachJSONLFields(src, keep, func(obj []byte) {
		var m map[string]any
		if err := json.Unmarshal(obj, &m); err != nil {
			t.Fatalf("fn got invalid JSON %q: %v", obj, err)
		}
		got = append(got, m)
	})
	return got, err
}

func usageOf(t *testing.T, m map[string]any) map[string]any {
	t.Helper()
	msg, _ := m["message"].(map[string]any)
	u, _ := msg["usage"].(map[string]any)
	return u
}

func TestEachJSONLFieldsKeepsOnlyRequestedFields(t *testing.T) {
	src := strings.NewReader(
		`{"type":"assistant","requestId":"req_1","uuid":"x","message":{"id":"msg_1","model":"claude-opus-5-5","content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":3,"output_tokens":4}}}` + "\n" +
			`{"type":"user","message":{"role":"user","content":"no usage here"}}` + "\n")
	got, err := collect(t, src)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d objects, want 2", len(got))
	}
	if got[0]["requestId"] != "req_1" || got[0]["uuid"] != nil {
		t.Fatalf("first object = %v", got[0])
	}
	msg := got[0]["message"].(map[string]any)
	if msg["id"] != "msg_1" || msg["model"] != "claude-opus-5-5" || msg["content"] != nil {
		t.Fatalf("message = %v", msg)
	}
	if u := usageOf(t, got[0]); u["input_tokens"] != 3.0 || u["output_tokens"] != 4.0 {
		t.Fatalf("usage = %v", u)
	}
	if usageOf(t, got[1]) != nil {
		t.Fatalf("user line should carry no usage: %v", got[1])
	}
}

// A line far longer than any buffer (a big Write tool input) is scanned, not
// held, and its usage — which comes after the content — is still found.
func TestEachJSONLFieldsHandlesHugeLines(t *testing.T) {
	big := strings.Repeat("x", 20*1024*1024)
	line := `{"type":"assistant","message":{"id":"msg_1","content":[{"type":"tool_use","input":{"content":"` + big +
		`"}}],"usage":{"input_tokens":7,"output_tokens":8}}}`
	got, err := collect(t, strings.NewReader(line+"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || usageOf(t, got[0])["output_tokens"] != 8.0 {
		t.Fatalf("got %v", got)
	}
}

// "usage" inside a string value (e.g. code being written) is not the field.
func TestEachJSONLFieldsIgnoresUsageInsideStrings(t *testing.T) {
	line := `{"type":"assistant","message":{"id":"m","content":"print(\"usage\": {\"input_tokens\": 99})","usage":{"input_tokens":1}}}`
	got, err := collect(t, strings.NewReader(line))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || usageOf(t, got[0])["input_tokens"] != 1.0 {
		t.Fatalf("got %v", got)
	}
}

func TestEachJSONLFieldsHandlesEscapesAndNesting(t *testing.T) {
	line := `{"type":"assistant","message":{"id":"a\"b\\","content":[{"usage":{"input_tokens":5}}],"usage":{"input_tokens":2,"cache_creation":{"ephemeral_1h_input_tokens":6}}}}`
	got, err := collect(t, strings.NewReader(line))
	if err != nil {
		t.Fatal(err)
	}
	msg := got[0]["message"].(map[string]any)
	if msg["id"] != `a"b\` {
		t.Fatalf("id = %q", msg["id"])
	}
	u := usageOf(t, got[0])
	if u["input_tokens"] != 2.0 || u["cache_creation"].(map[string]any)["ephemeral_1h_input_tokens"] != 6.0 {
		t.Fatalf("usage = %v (the array element's usage must not win)", u)
	}
}

func TestEachJSONLFieldsSkipsMalformedLines(t *testing.T) {
	src := strings.NewReader("not json\n" + `{"type":"assistant","message":{"usage":{"input_tokens":1}` + "\n" + // truncated
		`[1,2]` + "\n" + `{"type":"assistant","message":{"usage":{"input_tokens":2}}}` + "\n")
	got, err := collect(t, src)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || usageOf(t, got[0])["input_tokens"] != 2.0 {
		t.Fatalf("got %v", got)
	}
}

func TestEachJSONLFieldsReportsOversizedKeptField(t *testing.T) {
	line := `{"type":"assistant","message":{"usage":{"note":"` + strings.Repeat("x", MaxFieldValue) + `"}}}`
	_, err := collect(t, strings.NewReader(line+"\n"+`{"type":"assistant","message":{"usage":{"input_tokens":1}}}`))
	if !errors.Is(err, ErrFieldTooLarge) {
		t.Fatalf("err = %v, want ErrFieldTooLarge", err)
	}
}

func TestEachJSONLFieldsPropagatesReadErrors(t *testing.T) {
	boom := errors.New("disk went away")
	src := io.MultiReader(strings.NewReader(`{"type":"assistant","message":{"usage":{"input_tokens":1}}}`+"\n"), iotest.ErrReader(boom))
	got, err := collect(t, src)
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the read error", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d objects before the error, want 1", len(got))
	}
}

// Scanning a huge line must not allocate in proportion to it.
func TestEachJSONLFieldsMemoryIsBounded(t *testing.T) {
	line := `{"type":"assistant","message":{"content":"` + strings.Repeat("x", 20*1024*1024) + `","usage":{"input_tokens":1}}}` + "\n"
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	n := 0
	if err := eachJSONLFields(strings.NewReader(line), keep, func([]byte) { n++ }); err != nil {
		t.Fatal(err)
	}
	runtime.ReadMemStats(&after)
	if n != 1 {
		t.Fatalf("got %d objects, want 1", n)
	}
	if alloc := after.TotalAlloc - before.TotalAlloc; alloc > 2<<20 {
		t.Fatalf("allocated %d bytes scanning a 20 MiB line, want < 2 MiB", alloc)
	}
}
