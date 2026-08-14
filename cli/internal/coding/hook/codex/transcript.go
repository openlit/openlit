// Codex rollout/transcript JSONL reader.
//
// Codex writes one JSONL record per event under
// ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl. Every record has a
// `type` discriminator. The shapes we care about for telemetry are:
//
//	{"type":"session_meta",  "payload":{...}}
//	{"type":"turn_context",  "payload":{"turn_id":"..."}}
//	{"type":"response_item", "payload":{"type":"function_call"|"message"|"reasoning",...}}
//	{"type":"event_msg",     "payload":{"type":"token_count","info":{...}}}
//
// The token-count delta algorithm here: Codex's `token_count` events
// fire several times per turn and the `info.total_token_usage` field
// is a running cumulative counter for the entire session. To get
// *this* turn's usage we subtract the baseline (the value observed
// just before the assistant started producing model output for this
// turn) from the final (the value observed at end of turn).

package codex

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// maxTranscriptScan caps how many bytes of one rollout we'll read.
// Long sessions (hours of dense usage) can exceed our 4 MiB tail-file
// budget; we accept slight undercount on those rather than blow the
// 5s hook timeout.
const maxTranscriptScan = 32 * 1024 * 1024

// maxLineLen is the per-line scanner buffer ceiling. Codex's
// `response_item` records that wrap large tool outputs can be hundreds
// of KiB; 1 MiB is a comfortable safety margin.
const maxLineLen = 1 * 1024 * 1024

// codexLine is the outer JSON envelope every line in a rollout
// transcript shares.
type codexLine struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// sessionMeta captures the subset of fields Codex's `session_meta`
// record exposes about subagent linkage. We collapse the legacy
// `parent_thread_id` / `Source.Subagent.ThreadSpawn.*` fallbacks
// into the same struct so both old and new transcript versions are
// handled.
type sessionMeta struct {
	SessionID       string
	ThreadSource    string
	ParentSessionID string
	AgentRole       string
	AgentNickname   string
	AgentDepth      int
}

// codexTokenUsage mirrors the per-turn token counters Codex emits in
// every `token_count` event. We use the same field names as the wire
// format so a JSON unmarshal in `parseTokenUsageInfo` is trivial.
type codexTokenUsage struct {
	InputTokens           int64 `json:"input_tokens"`
	CachedInputTokens     int64 `json:"cached_input_tokens"`
	OutputTokens          int64 `json:"output_tokens"`
	ReasoningOutputTokens int64 `json:"reasoning_output_tokens"`
	TotalTokens           int64 `json:"total_tokens"`
}

// codexTokenUsageInfo is the payload of a `token_count` event_msg. The
// `last_token_usage` is the most recent single-shot, and
// `total_token_usage` is the cumulative for the entire session — we
// subtract the baseline from the final cumulative to attribute usage
// to a specific turn.
type codexTokenUsageInfo struct {
	TotalTokenUsage    codexTokenUsage `json:"total_token_usage"`
	LastTokenUsage     codexTokenUsage `json:"last_token_usage"`
	ModelContextWindow int64           `json:"model_context_window"`
}

// codexTokenSnapshot is the result of scanning a transcript for a
// specific turn's token usage. `TurnUsage` is the attributed-to-turn
// delta we surface as `gen_ai.usage.*`. `TotalUsage` keeps the
// cumulative numbers so the session-root rollup is also possible.
type codexTokenSnapshot struct {
	TurnID             string
	TurnUsage          codexTokenUsage
	BaselineUsage      codexTokenUsage
	LastUsage          codexTokenUsage
	TotalUsage         codexTokenUsage
	ModelContextWindow int64
}

// readSessionMeta scans the head of a transcript for the first
// `session_meta` block. Returns ok=false when the file is missing or
// the block can't be parsed.
func readSessionMeta(path string) (sessionMeta, bool) {
	var found sessionMeta
	ok := false
	_ = scanCodexLines(path, func(raw []byte) (bool, error) {
		var l codexLine
		if err := json.Unmarshal(raw, &l); err != nil || l.Type != "session_meta" {
			return false, nil
		}
		meta, mok := parseSessionMeta(l.Payload)
		if !mok {
			return true, nil
		}
		found = meta
		ok = true
		return true, nil
	})
	return found, ok
}

// readTokenUsageForTurn scans `path` for the cumulative token-usage
// snapshots that bracket Codex's `turn_id`. Returns ok=false when:
//   - `path` or `turnID` are empty
//   - the transcript can't be opened or never contained the turn
//   - the delta would be non-positive (defensive guard against
//     out-of-order rollout writes)
//
// On success the returned snapshot's `TurnUsage` is the per-turn delta
// suitable for emitting as `gen_ai.usage.input_tokens`,
// `gen_ai.usage.output_tokens`, `gen_ai.usage.cache.read_input_tokens`,
// and `coding_agent.llm.reasoning_tokens`.
func readTokenUsageForTurn(path, turnID string) (codexTokenSnapshot, bool) {
	if path == "" || turnID == "" {
		return codexTokenSnapshot{}, false
	}

	var (
		activeTurnID      string
		seenAnyTurn       bool
		targetStarted     bool
		targetIsFirstTurn bool
		targetModelActive bool
		haveBaseline      bool
		baseline          codexTokenUsage
		haveLastTotal     bool
		lastTotal         codexTokenUsage
		haveFinal         bool
		finalInfo         codexTokenUsageInfo
	)

	err := scanCodexLines(path, func(raw []byte) (bool, error) {
		var l codexLine
		if err := json.Unmarshal(raw, &l); err != nil {
			return false, nil
		}
		switch l.Type {
		case "turn_context":
			nextTurnID := parseCodexTurnID(l.Payload)
			if nextTurnID == "" {
				return false, nil
			}
			if !seenAnyTurn {
				targetIsFirstTurn = nextTurnID == turnID
			}
			seenAnyTurn = true
			activeTurnID = nextTurnID
			if nextTurnID == turnID && !targetStarted {
				targetStarted = true
				targetModelActive = false
				if haveLastTotal {
					baseline = lastTotal
					haveBaseline = true
				}
			}
		case "response_item":
			if activeTurnID != turnID || !targetStarted {
				return false, nil
			}
			if isModelActivity(l.Payload) {
				targetModelActive = true
			}
		case "event_msg":
			info, ok := parseTokenUsageInfo(l.Payload)
			if !ok {
				return false, nil
			}
			if activeTurnID == turnID && targetStarted {
				if !targetModelActive {
					// pre-model snapshots roll forward the baseline
					baseline = info.TotalTokenUsage
					haveBaseline = true
					lastTotal = info.TotalTokenUsage
					haveLastTotal = true
					return false, nil
				}
				finalInfo = info
				haveFinal = true
			}
			lastTotal = info.TotalTokenUsage
			haveLastTotal = true
		}
		return false, nil
	})
	if err != nil || !targetStarted || !haveFinal {
		return codexTokenSnapshot{}, false
	}
	if !haveBaseline {
		if !targetIsFirstTurn {
			return codexTokenSnapshot{}, false
		}
		baseline = codexTokenUsage{}
	}
	turnUsage, ok := subtractCodexUsage(finalInfo.TotalTokenUsage, baseline)
	if !ok || !hasPositiveCodexUsage(turnUsage) {
		return codexTokenSnapshot{}, false
	}
	return codexTokenSnapshot{
		TurnID:             turnID,
		TurnUsage:          turnUsage,
		BaselineUsage:      baseline,
		LastUsage:          finalInfo.LastTokenUsage,
		TotalUsage:         finalInfo.TotalTokenUsage,
		ModelContextWindow: finalInfo.ModelContextWindow,
	}, true
}

// scanCodexLines reads the file line-by-line, invoking visit on each.
// Stops when visit returns done=true or the byte budget is exceeded.
// Best-effort: a corrupt line is skipped silently, never fatal.
func scanCodexLines(path string, visit func(raw []byte) (bool, error)) error {
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(home, strings.TrimPrefix(path, "~/"))
		}
	}
	f, err := os.Open(path) //nolint:gosec // path comes from the codex hook payload
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), maxLineLen)
	var read int64
	for scanner.Scan() {
		read += int64(len(scanner.Bytes())) + 1
		if read > maxTranscriptScan {
			return fmt.Errorf("codex transcript byte budget exceeded")
		}
		done, err := visit(scanner.Bytes())
		if err != nil {
			return err
		}
		if done {
			return nil
		}
	}
	return scanner.Err()
}

// parseSessionMeta reads the session_meta envelope on a Codex
// transcript header. Only the current top-level layout is supported —
// older Codex builds shipped the fields under
// source.subagent.thread_spawn.*, which we no longer maintain.
// Returns ok=true only when at least one identifying field is
// non-empty.
func parseSessionMeta(raw json.RawMessage) (sessionMeta, bool) {
	var p struct {
		ID              string `json:"id"`
		ThreadSource    string `json:"thread_source"`
		ParentSessionID string `json:"parent_session_id"`
		AgentRole       string `json:"agent_role"`
		AgentNickname   string `json:"agent_nickname"`
		AgentDepth      int    `json:"agent_depth"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return sessionMeta{}, false
	}
	meta := sessionMeta{
		SessionID:       p.ID,
		ThreadSource:    p.ThreadSource,
		ParentSessionID: p.ParentSessionID,
		AgentRole:       p.AgentRole,
		AgentNickname:   p.AgentNickname,
		AgentDepth:      p.AgentDepth,
	}
	if meta.ThreadSource == "" && meta.ParentSessionID != "" {
		meta.ThreadSource = "subagent"
	}
	if meta.SessionID == "" && meta.ParentSessionID == "" && meta.ThreadSource == "" {
		return sessionMeta{}, false
	}
	return meta, true
}

func parseCodexTurnID(raw json.RawMessage) string {
	var p struct {
		TurnID string `json:"turn_id"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return ""
	}
	return p.TurnID
}

func parseTokenUsageInfo(raw json.RawMessage) (codexTokenUsageInfo, bool) {
	var p struct {
		Type string               `json:"type"`
		Info *codexTokenUsageInfo `json:"info"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return codexTokenUsageInfo{}, false
	}
	if p.Type != "token_count" || p.Info == nil {
		return codexTokenUsageInfo{}, false
	}
	return *p.Info, true
}

// isModelActivity reports whether a `response_item` payload represents
// model-side activity (a reasoning chunk, a function call, an
// assistant message, a custom-tool call, or a local-shell call). Used
// to detect the boundary between baseline and final token snapshots —
// any model activity inside the active turn promotes the next
// `token_count` event to "final".
func isModelActivity(raw json.RawMessage) bool {
	var item struct {
		Type string `json:"type"`
		Role string `json:"role"`
	}
	if err := json.Unmarshal(raw, &item); err == nil && item.Type != "" {
		switch item.Type {
		case "reasoning", "function_call", "custom_tool_call", "local_shell_call":
			return true
		case "message":
			return item.Role == "assistant"
		}
	}
	// Some Codex builds wrap the response item in `{"item": {...}}`.
	var wrapped struct {
		Item struct {
			Type string `json:"type"`
			Role string `json:"role"`
		} `json:"item"`
	}
	if err := json.Unmarshal(raw, &wrapped); err == nil && wrapped.Item.Type != "" {
		switch wrapped.Item.Type {
		case "reasoning", "function_call", "custom_tool_call", "local_shell_call":
			return true
		case "message":
			return wrapped.Item.Role == "assistant"
		}
	}
	return false
}

func subtractCodexUsage(final, baseline codexTokenUsage) (codexTokenUsage, bool) {
	out := codexTokenUsage{
		InputTokens:           final.InputTokens - baseline.InputTokens,
		CachedInputTokens:     final.CachedInputTokens - baseline.CachedInputTokens,
		OutputTokens:          final.OutputTokens - baseline.OutputTokens,
		ReasoningOutputTokens: final.ReasoningOutputTokens - baseline.ReasoningOutputTokens,
		TotalTokens:           final.TotalTokens - baseline.TotalTokens,
	}
	if out.InputTokens < 0 || out.CachedInputTokens < 0 ||
		out.OutputTokens < 0 || out.ReasoningOutputTokens < 0 ||
		out.TotalTokens < 0 {
		return codexTokenUsage{}, false
	}
	return out, true
}

func hasPositiveCodexUsage(u codexTokenUsage) bool {
	return u.InputTokens > 0 ||
		u.CachedInputTokens > 0 ||
		u.OutputTokens > 0 ||
		u.ReasoningOutputTokens > 0 ||
		u.TotalTokens > 0
}

// findRolloutForSession walks today's Codex `sessions/<date>` tree
// looking for a `rollout-*.jsonl` whose first line contains the given
// `sessionID`. This is the fallback when the hook payload doesn't
// include `transcript_path`. We only scan today's directory because
// Stop fires within the same calendar day as the session start
// (sessions span days only on truly long-running setups — an
// acceptable corner-case to undercount). Returns "" when no match
// is found.
func findRolloutForSession(sessionID string) string {
	if sessionID == "" {
		return ""
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	// Try today and yesterday (UTC) — sessions that wrap midnight UTC
	// rarely cross more than a single day boundary, and scanning two
	// days is still cheap.
	now := time.Now().UTC()
	candidates := []string{
		filepath.Join(home, ".codex", "sessions", now.Format("2006/01/02")),
		filepath.Join(home, ".codex", "sessions", now.AddDate(0, 0, -1).Format("2006/01/02")),
	}
	for _, dir := range candidates {
		if path := scanRolloutDirForSession(dir, sessionID); path != "" {
			return path
		}
	}
	return ""
}

func scanRolloutDirForSession(dir, sessionID string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	// Most-recent first so a fresh session's transcript wins over an
	// older one with the same prefix in the filename.
	sort.Slice(entries, func(i, j int) bool {
		ii, _ := entries[i].Info()
		jj, _ := entries[j].Info()
		if ii == nil || jj == nil {
			return false
		}
		return ii.ModTime().After(jj.ModTime())
	})
	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(e.Name(), "rollout-") || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		if rolloutFirstLineHasSession(path, sessionID) {
			return path
		}
	}
	return ""
}

func rolloutFirstLineHasSession(path, sessionID string) bool {
	f, err := os.Open(path) //nolint:gosec // path under ~/.codex
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()
	r := bufio.NewReaderSize(f, 64*1024)
	for i := 0; i < 4; i++ {
		// `session_meta` is always at or near the top of a rollout;
		// reading up to 4 lines is enough to find it.
		line, err := r.ReadString('\n')
		if err != nil && line == "" {
			return false
		}
		if strings.Contains(line, sessionID) {
			return true
		}
	}
	return false
}
