package claudecode

// Transcript reader for Claude Code's per-session JSONL file.
//
// Each hook invocation reads only the new
// bytes since the last invocation, coalesces streaming assistant fragments
// by RequestID, and produces one "complete LLM turn" record per assistant
// message that finished cleanly (non-empty `stop_reason`).
//
// The transcript file is what gives us, on a per-turn basis:
//   - the assistant's text, thinking, and tool_use blocks (chat content)
//   - the user's prompt (text) and tool_result blocks (tool outputs)
//   - the model, request id, and authoritative usage (tokens + cache)
//
// SessionEnd alone would let us realize cost/tokens at the end, but the
// chat tab on the trace detail page expects per-turn spans with input +
// output messages — that's what Stop / PostToolUse drives once we read
// the new tail.

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"strings"
)

// transcriptLine is a partial decoding of a single JSONL line.
type transcriptLine struct {
	Type        string          `json:"type"`
	UUID        string          `json:"uuid"`
	ParentUUID  string          `json:"parentUuid"`
	Timestamp   string          `json:"timestamp"`
	SessionID   string          `json:"sessionId"`
	Version     string          `json:"version"`
	GitBranch   string          `json:"gitBranch"`
	CWD         string          `json:"cwd"`
	Entrypoint  string          `json:"entrypoint"`
	RequestID   string          `json:"requestId"`
	IsSidechain bool            `json:"isSidechain"`
	Message     json.RawMessage `json:"message"`

	endOffset int64 // byte position immediately after this line
}

// assistantMessage is the decoded `message` field of an assistant line.
type assistantMessage struct {
	Model      string                  `json:"model"`
	ID         string                  `json:"id"`
	Content    []assistantContentBlock `json:"content"`
	StopReason string                  `json:"stop_reason"`
	Usage      assistantUsage          `json:"usage"`
}

type assistantContentBlock struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	Thinking string          `json:"thinking,omitempty"`
	ID       string          `json:"id,omitempty"`
	Name     string          `json:"name,omitempty"`
	Input    json.RawMessage `json:"input,omitempty"`
}

type assistantUsage struct {
	InputTokens              int64 `json:"input_tokens"`
	OutputTokens             int64 `json:"output_tokens"`
	CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int64 `json:"cache_read_input_tokens"`
}

// skipTypes are line types the LLM-turn synthesiser ignores.
var skipTypes = map[string]bool{
	"file-history-snapshot": true,
	"queue-operation":       true,
	"attachment":            true,
	"permission-mode":       true,
	"last-prompt":           true,
	"ai-title":              true,
	"system":                true,
}

const maxScannerBuf = 10 * 1024 * 1024 // 10 MB — Claude Code emits multi-MB tool_result lines

// maxBytesPerInvocation caps how many transcript bytes a single hook
// process will scan. Claude Code transcripts grow to hundreds of MB
// over a long-running chat; on the very first hook event (offset == 0
// because sessionstate hasn't seen the session yet), an unbounded
// scan would happily read the entire file and starve the 5s hook
// timeout. The cap is a soft ceiling — we honour it by truncating the
// returned new-offset to (offset + cap) so the next invocation
// resumes from where we stopped. Set generous enough that a 1MB/sec
// transcript would still drain in real time across consecutive hook
// invocations.
const maxBytesPerInvocation = 8 * 1024 * 1024 // 8 MiB

// readTranscript reads JSONL lines from path starting at the supplied
// byte offset and returns the parsed lines plus the new offset.
// Unparseable lines are skipped silently — telemetry must never fail
// on a partial write.
func readTranscript(path string, offset int64) ([]transcriptLine, int64, error) {
	if path == "" {
		return nil, offset, nil
	}
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			path = home + path[1:]
		}
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, offset, err
	}
	defer func() { _ = f.Close() }()

	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			return nil, offset, err
		}
	}

	scanner := bufio.NewScanner(io.LimitReader(f, maxBytesPerInvocation))
	scanner.Buffer(make([]byte, 0, 64*1024), maxScannerBuf)

	var lastAdvance int
	scanner.Split(func(data []byte, atEOF bool) (int, []byte, error) {
		advance, token, err := bufio.ScanLines(data, atEOF)
		lastAdvance = advance
		return advance, token, err
	})

	var lines []transcriptLine
	pos := offset
	for scanner.Scan() {
		data := scanner.Bytes()
		lineLen := int64(lastAdvance)

		var line transcriptLine
		if err := json.Unmarshal(data, &line); err != nil {
			pos += lineLen
			continue
		}
		if skipTypes[line.Type] {
			pos += lineLen
			continue
		}
		line.endOffset = pos + lineLen
		lines = append(lines, line)
		pos += lineLen
	}
	return lines, pos, scanner.Err()
}

// coalescedTurn is one logical assistant turn after coalescing streaming
// fragments by RequestID. `lastSafeOffset` is the byte position we can
// commit to disk; trailing incomplete turns leave it unchanged so the
// next hook invocation re-reads them.
type coalescedTurn struct {
	line transcriptLine
	msg  assistantMessage
}

// coalesceAssistants merges consecutive assistant lines sharing the
// same RequestID into one turn, dropping anything that hasn't reached a
// `stop_reason`. Returns the safe turns plus the offset that lets the
// next reader resume immediately after them.
//
// User / tool_result lines from the transcript are intentionally NOT
// returned. We used to walk them to attach a `turnContext` to each
// assistant turn so the user-prompt that triggered the turn could be
// stamped onto the LLM-turn span — but Claude Code's transcript
// stores its *wrapped* prompt (prefixed with `<ide_opened_file>…` and
// similar IDE context envelopes), not the raw text the user typed.
// We rely on the UserPromptSubmit hook (`emitUserPrompt`) for the raw
// user-prompt and on `coding_agent.tool.call` spans for tool bodies,
// so the transcript reader only needs to surface assistant turns.
func coalesceAssistants(lines []transcriptLine) ([]coalescedTurn, int64) {
	var (
		turns          []coalescedTurn
		pending        []transcriptLine
		lastSafeOffset int64
		lastSafeLen    int
	)

	markSafe := func(off int64) {
		lastSafeOffset = off
		lastSafeLen = len(turns)
	}

	appendIfComplete := func(line transcriptLine) {
		var msg assistantMessage
		if err := json.Unmarshal(line.Message, &msg); err != nil || strings.TrimSpace(msg.StopReason) == "" {
			return
		}
		turns = append(turns, coalescedTurn{line: line, msg: msg})
		markSafe(line.endOffset)
	}

	flush := func() {
		if len(pending) == 0 {
			return
		}
		last := pending[len(pending)-1]
		var lastMsg assistantMessage
		if err := json.Unmarshal(last.Message, &lastMsg); err == nil && strings.TrimSpace(lastMsg.StopReason) != "" {
			merged := mergeAssistantGroup(pending)
			var msg assistantMessage
			if err := json.Unmarshal(merged.Message, &msg); err == nil {
				turns = append(turns, coalescedTurn{line: merged, msg: msg})
				markSafe(merged.endOffset)
			}
		}
		pending = nil
	}

	for _, line := range lines {
		if line.Type == "assistant" {
			if line.RequestID == "" {
				flush()
				appendIfComplete(line)
				continue
			}
			if len(pending) > 0 && pending[0].RequestID != line.RequestID {
				flush()
			}
			pending = append(pending, line)
			continue
		}
		flush()
	}
	flush()

	return turns[:lastSafeLen], lastSafeOffset
}

func mergeAssistantGroup(group []transcriptLine) transcriptLine {
	if len(group) == 1 {
		return group[0]
	}
	final := group[len(group)-1]
	var blocks []assistantContentBlock
	for _, l := range group {
		var m assistantMessage
		if err := json.Unmarshal(l.Message, &m); err != nil {
			continue
		}
		blocks = append(blocks, m.Content...)
	}
	var finalMsg assistantMessage
	if err := json.Unmarshal(final.Message, &finalMsg); err != nil {
		return final
	}
	finalMsg.Content = blocks
	if merged, err := json.Marshal(finalMsg); err == nil {
		final.Message = merged
	}
	return final
}
