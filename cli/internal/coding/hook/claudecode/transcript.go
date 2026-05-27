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

// userMessage is the decoded `message` field of a user line. Content is
// polymorphic: a plain string for the original prompt, or an array of
// tool_result / text blocks when the trigger is a tool reply.
type userMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type userContentBlock struct {
	Type       string          `json:"type"`
	ToolUseID  string          `json:"tool_use_id,omitempty"`
	RawContent json.RawMessage `json:"content,omitempty"`
	IsError    bool            `json:"is_error,omitempty"`
	Text       string          `json:"text,omitempty"`
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

	scanner := bufio.NewScanner(f)
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
func coalesceAssistants(lines []transcriptLine) ([]coalescedTurn, []transcriptLine, int64) {
	var (
		turns          []coalescedTurn
		userOrToolBuf  []transcriptLine
		userOrToolKeep []transcriptLine
		pending        []transcriptLine
		lastSafeOffset int64
		lastSafeLen    int
	)

	markSafe := func(off int64) {
		lastSafeOffset = off
		lastSafeLen = len(turns)
		userOrToolKeep = append(userOrToolKeep, userOrToolBuf...)
		userOrToolBuf = nil
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
		userOrToolBuf = append(userOrToolBuf, line)
	}
	flush()

	return turns[:lastSafeLen], userOrToolKeep, lastSafeOffset
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

// turnContext is the user-side trigger that produced an assistant turn.
// Either a free-form prompt (the user typed) or a list of tool_result
// blocks (the agent loop fed tool outputs back to the model).
type turnContext struct {
	Prompt      string
	ToolResults []toolResultBlock
}

type toolResultBlock struct {
	ToolUseID string
	Content   string
	IsError   bool
}

// parseUserLine extracts a turnContext from a user-typed message OR a
// tool_result envelope. We only care about whichever was most recent
// before the assistant turn.
func parseUserLine(line transcriptLine) (turnContext, bool) {
	var msg userMessage
	if err := json.Unmarshal(line.Message, &msg); err != nil {
		return turnContext{}, false
	}
	// Plain string: user typed a prompt.
	var text string
	if err := json.Unmarshal(msg.Content, &text); err == nil && strings.TrimSpace(text) != "" {
		return turnContext{Prompt: text}, true
	}
	// Array of blocks: tool result envelope, or a mixed text+tool envelope.
	var blocks []userContentBlock
	if err := json.Unmarshal(msg.Content, &blocks); err == nil {
		ctx := turnContext{}
		for _, b := range blocks {
			switch b.Type {
			case "text":
				if strings.TrimSpace(b.Text) != "" {
					ctx.Prompt = b.Text
				}
			case "tool_result":
				ctx.ToolResults = append(ctx.ToolResults, toolResultBlock{
					ToolUseID: b.ToolUseID,
					Content:   userContentToText(b.RawContent),
					IsError:   b.IsError,
				})
			}
		}
		if ctx.Prompt != "" || len(ctx.ToolResults) > 0 {
			return ctx, true
		}
	}
	return turnContext{}, false
}

// userContentToText flattens a polymorphic content field (string OR
// array of {type,text} blocks) into a single string.
func userContentToText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &blocks); err == nil {
		var parts []string
		for _, b := range blocks {
			if b.Text != "" {
				parts = append(parts, b.Text)
			}
		}
		return strings.Join(parts, "\n")
	}
	return string(raw)
}
