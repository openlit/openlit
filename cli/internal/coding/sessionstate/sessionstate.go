// Package sessionstate persists tiny per-session facts that the CLI
// needs to remember across hook invocations.
//
// Each hook invocation is a fresh process, so any state the host plugin
// doesn't replay on every event has to be cached on disk. We use this
// for two things today:
//
//  1. **User identity** (Cursor's `user_email`, etc.) — vendors only
//     emit it on a subset of events, so we cache it after the first
//     event and replay it as a resource attribute on every subsequent
//     hook invocation in the same session.
//  2. **Last-seen mode + model** — Cursor's composer_mode (agent / ask
//     / plan) and request model can change mid-session. We cache the
//     most recent value and let the per-vendor adapter compare it
//     against the new payload to emit a `coding_agent.permission_mode.changed`
//     event when the user toggles modes.
//
// The cache lives under $XDG_CACHE_HOME/openlit/sessions/<sid>.json.
// Files are bounded in size (a few hundred bytes each), are written
// 0600, and are best-effort: a corrupt or missing file falls through to
// the empty state and the hook proceeds without it.
package sessionstate

import (
	"encoding/json"
	"math/rand"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

// gcMaxAge is the on-disk retention for a session cache entry.
// Entries older than this are reaped by GC() on a probabilistic
// schedule. Bumped well above any plausible chat thread length so
// resuming an idle conversation still finds its cached identity.
const gcMaxAge = 7 * 24 * time.Hour

// gcEvery controls the GC sampling probability. We run GC on roughly
// 1 in N hook invocations rather than every call (most hooks run in
// <50 ms; an unconditional readdir per hook would noticeably slow the
// hot path on machines with thousands of session files).
const gcEvery = 1000

// State holds the per-session facts we currently track. Add fields
// here when a vendor adds another sticky attribute we want to compare
// against on later hook events.
type State struct {
	// User is the identity to stamp on resource attrs when the
	// vendor's payload doesn't carry one.
	User string `json:"user,omitempty"`

	// PermissionMode is Cursor's composer_mode / Claude Code's
	// permission mode. Values: "agent" | "ask" | "plan" |
	// "acceptEdits" | "bypassPermissions" | "default" | "auto".
	PermissionMode string `json:"permission_mode,omitempty"`

	// Model is the most recently-seen model id (e.g.
	// "claude-opus-4-7-thinking-xhigh"). Cursor reports this on
	// every prompt-bearing event; tracking it lets us emit a
	// model-changed event mid-session.
	Model string `json:"model,omitempty"`

	// CWD is the working folder the agent runs in for this session.
	// Cached so spans emitted by hook events that lack a cwd in
	// their payload (e.g. afterAgentResponse / stop) still carry the
	// session's working folder as a resource attribute.
	CWD string `json:"cwd,omitempty"`

	// RepoURL / Branch are the VCS snapshot taken at session start.
	// Re-snapshotting on every hook event would mean a `git remote
	// -v` + `git rev-parse` per event; caching the first snapshot is
	// fine because branch changes mid-session are rare and the next
	// cold-start hook event re-runs git anyway.
	RepoURL string `json:"repo_url,omitempty"`
	Branch  string `json:"branch,omitempty"`

	// ConversationID is Cursor's `conversation_id` (or equivalent on
	// other vendors). Cached separately from SessionID because they
	// may differ when a subagent is running: the subagent's own
	// session_id is fresh but it inherits the parent's
	// conversation_id, which is what we want to roll up in the UI.
	ConversationID string `json:"conversation_id,omitempty"`

	// ParentConversationID points at the spawning agent's chat
	// thread, when this session is a subagent of another. Stamped
	// from Cursor's `parent_conversation_id` field — present on
	// subagentStart and (we hope) on subagent's own hook events.
	// The UI uses this to fold subagent rows under their parent
	// chat instead of listing them as standalone sessions.
	ParentConversationID string `json:"parent_conversation_id,omitempty"`

	// IsBackgroundAgent is true when Cursor's payload flags the
	// session as a background / parallel-worker agent. UI hides
	// these from the default Sessions list and shows them inside
	// the parent chat's trace detail instead.
	IsBackgroundAgent bool `json:"is_background_agent,omitempty"`

	// SessionRolledUp counters that Phase C's minimal mode emits on
	// sessionEnd in lieu of per-event spans. Always safe to populate;
	// only consumed when the active capture mode is "minimal".
	ToolCallCount int     `json:"tool_call_count,omitempty"`
	SubagentCount int     `json:"subagent_count,omitempty"`
	InputTokens   int64   `json:"input_tokens,omitempty"`
	OutputTokens  int64   `json:"output_tokens,omitempty"`
	CostUSD       float64 `json:"cost_usd,omitempty"`

	// Per-session code-change rollups accumulated across hook
	// invocations and stamped on the session-root span at
	// SessionEnd. All four line totals are absolute (not deltas).
	// Adapters bump these via the shared bumpCounters helper
	// regardless of content-capture mode — line counts are not
	// considered user content and are always safe to record.
	LinesAdded      int `json:"lines_added,omitempty"`
	LinesRemoved    int `json:"lines_removed,omitempty"`
	LinesAccepted   int `json:"lines_accepted,omitempty"`
	LinesRejected   int `json:"lines_rejected,omitempty"`
	EditAcceptCount int `json:"edit_accept_count,omitempty"`
	EditRejectCount int `json:"edit_reject_count,omitempty"`
	CommitCount     int `json:"commit_count,omitempty"`
	PRCount         int `json:"pr_count,omitempty"`

	// PendingEdits is the rejection-heuristic backing store for
	// vendors that emit a Pre+Post pair around their edit tool
	// (Claude Code's PreToolUse / PostToolUse for Edit / Write /
	// MultiEdit). Keyed by the vendor's tool-use id, value is the
	// proposed change we'd attribute as rejected if the Post never
	// fires for this turn. UserPromptSubmit / SessionEnd drain
	// leftover entries as rejections; PostToolUse resolves them as
	// accepts and removes the entry. Bounded to ~32 entries per
	// session so a runaway agent can't grow the cache unbounded.
	PendingEdits map[string]*PendingEdit `json:"pending_edits,omitempty"`

	// TerminalType is the resolved IDE/terminal hosting the agent
	// (e.g. `vscode`, `cursor`, `iterm`). Sourced from Claude Code's
	// transcript `entrypoint` (most reliable) or env / process-tree
	// detection (fallback). Cached so the session-root span and every
	// follow-up span agree on the value.
	TerminalType string `json:"terminal_type,omitempty"`

	// TranscriptPath is the absolute path to the vendor's transcript
	// JSONL (Claude Code's `transcript_path`). Cached so non-lifecycle
	// hook events (Stop / PostToolUse) can resume reading without the
	// payload re-shipping it.
	TranscriptPath string `json:"transcript_path,omitempty"`

	// TranscriptOffset is the byte position the transcript reader
	// last advanced to. Subsequent hook events resume reading from
	// here; only new assistant turns produce new LLM-turn spans.
	TranscriptOffset int64 `json:"transcript_offset,omitempty"`

	// EmittedAssistantTurnIDs records assistant `requestId`s we've
	// already emitted as LLM-turn spans. Defensive de-dup so a
	// retried hook event or a transcript rewrite (Claude Code's
	// streaming fragments) doesn't double-count tokens or chat
	// content. Bounded to the most recent ~256 ids.
	EmittedAssistantTurnIDs []string `json:"emitted_assistant_turn_ids,omitempty"`

	// CodexTurns holds per-turn fragments for the Codex adapter,
	// keyed by Codex's `turn_id`. Codex's hook protocol scopes
	// every event to a turn (UserPromptSubmit, PreToolUse,
	// PostToolUse, Stop all carry `turn_id`), and only `Stop`
	// gives us the assistant's final text + token totals. Adapters
	// accumulate the prompt and per-tool records on intermediate
	// events and drain the fragment into one `coding_agent.llm.turn`
	// span on Stop. Bounded to the most recent ~16 turn fragments
	// so a long session doesn't grow this map unbounded.
	CodexTurns map[string]*CodexTurnFragment `json:"codex_turns,omitempty"`

	// CodexSubagent caches the parent-session linkage we extracted
	// from Codex's transcript `session_meta` block at SessionStart.
	// Stamped on every subsequent span this session emits so the UI
	// can fold subagent runs under their spawning chat.
	CodexSubagent *CodexSubagentLink `json:"codex_subagent,omitempty"`

	// ActiveTaskToolUseID is the `tool_use_id` of the most recent
	// Claude Code Task tool invocation. Claude Code's subagents don't
	// fire intermediate hooks — only PreToolUse(Task) at spawn time
	// and SubagentStop at completion. Caching the spawning tool-use
	// id here lets us echo it onto the SubagentStop span as
	// `gen_ai.tool.call.id`, which the chat view uses to group the
	// Task tool call + subagent block into one collapsible item.
	// Cleared on SubagentStop.
	ActiveTaskToolUseID string `json:"active_task_tool_use_id,omitempty"`

	// SessionStartedAt is the wall-clock at which we first saw a
	// `SessionStart` (or equivalent) lifecycle event for this
	// (sessionID, vendor) pair. Cached so SessionEnd / sessionEnd can
	// compute a real duration without depending on the vendor to
	// re-ship the start time. Previously Claude Code rolled this in
	// as `StartedAt = time.Now()` at *both* events, producing ~0ms
	// session durations across the board.
	SessionStartedAt time.Time `json:"session_started_at,omitempty"`

	// LastSessionRootEmitAt is the wall-clock of the most recent
	// `coding_agent.session` span emission. Used by Codex (which has
	// no SessionEnd hook and would otherwise re-emit the session-
	// root span on EVERY Stop event) to throttle re-emits to once
	// every ~60s. Deterministic SpanIDs ensure all re-emits collapse
	// onto a single `otel_traces` row in ClickHouse, but throttling
	// still saves the OTLP serialise + send cost on long sessions
	// with dozens of turns.
	LastSessionRootEmitAt time.Time `json:"last_session_root_emit_at,omitempty"`
}

// CodexTurnFragment is the per-turn state Codex's adapter accumulates
// between intermediate hook events (UserPromptSubmit, PostToolUse) and
// the closing Stop event. One Stop emits one `coding_agent.llm.turn`
// span built from this fragment.
type CodexTurnFragment struct {
	// TurnID is Codex's `turn_id`. Cached so list iteration keeps a
	// stable key even when callers don't pass the id through.
	TurnID string `json:"turn_id,omitempty"`
	// Prompt is the user's verbatim prompt (UserPromptSubmit). Only
	// populated under `full` capture mode.
	Prompt string `json:"prompt,omitempty"`
	// LastAssistantMessage is Codex's plain-text assistant reply on
	// Stop. Only populated under `full` capture mode.
	LastAssistantMessage string `json:"last_assistant_message,omitempty"`
	// Tools accumulates one entry per PostToolUse event so the
	// closing `coding_agent.llm.turn` can render `tool_call_response`
	// parts. Body fields (Input / Response) only land under `full`.
	Tools []CodexToolRecord `json:"tools,omitempty"`
	// StartedAt is when we first saw this turn (UserPromptSubmit or
	// SessionStart fallback). Used as the LLM-turn span StartedAt
	// on Stop so dashboards get a real duration.
	StartedAt time.Time `json:"started_at,omitempty"`
	// Model + Source come from the SessionStart/UserPromptSubmit
	// payload. Cached because the Stop event itself often omits
	// them on subagent invocations.
	Model  string `json:"model,omitempty"`
	Source string `json:"source,omitempty"`
	// StopHookActive is Codex's signal that the hook fired
	// pre-emptively (a previous turn hadn't fully stopped). Surfaced
	// as a tag so dashboards can quarantine these rows.
	StopHookActive bool `json:"stop_hook_active,omitempty"`
}

// CodexToolRecord is one tool invocation observed inside a Codex turn,
// accumulated by `PostToolUse`. The fields mirror Codex's hook payload
// (tool_name, tool_use_id, tool_input, tool_response, tool_duration_ms,
// status, error) plus the resolved decision (Status). Body fields are
// gated on `full` content capture by the adapter before we ever write
// here so the on-disk cache cannot carry tool args/results in
// metadata_only mode.
type CodexToolRecord struct {
	ToolName     string `json:"tool_name,omitempty"`
	ToolUseID    string `json:"tool_use_id,omitempty"`
	ToolInput    string `json:"tool_input,omitempty"`
	ToolResponse string `json:"tool_response,omitempty"`
	Status       string `json:"status,omitempty"`
	ErrorMessage string `json:"error_message,omitempty"`
	Cwd          string `json:"cwd,omitempty"`
	DurationMs   int64  `json:"duration_ms,omitempty"`
	CompletedAt  string `json:"completed_at,omitempty"`
}

// CodexSubagentLink captures Codex's parent → child thread relationship
// when the current session is a subagent of another. Sourced from the
// transcript's `session_meta` record at SessionStart, then stamped on
// every span via resource attributes.
type CodexSubagentLink struct {
	ParentSessionID string `json:"parent_session_id,omitempty"`
	AgentRole       string `json:"agent_role,omitempty"`
	AgentNickname   string `json:"agent_nickname,omitempty"`
	AgentDepth      int    `json:"agent_depth,omitempty"`
}

// PendingEdit is one row in the rejection-heuristic backing store —
// see `State.PendingEdits`. Adapters stash a PendingEdit on the
// vendor's pre-edit hook (Claude Code's PreToolUse) and either
// resolve+remove it on the matching post-edit hook (PostToolUse,
// accept path) or drain it as rejected when the next UserPromptSubmit
// arrives without a paired PostToolUse (reject path).
//
// LinesAdded / LinesRemoved are inferred from the proposed change at
// pre-time (Claude Code's `new_string` / `old_string` for Edit;
// `content` for Write). Counts inevitably under-count when the
// vendor's tool ultimately wrote a different range, but they're
// directionally honest and the dominant pattern is "pre and post
// agree on the change".
type PendingEdit struct {
	ToolUseID    string `json:"tool_use_id,omitempty"`
	ToolName     string `json:"tool_name,omitempty"`
	FilePath     string `json:"file_path,omitempty"`
	LinesAdded   int    `json:"lines_added,omitempty"`
	LinesRemoved int    `json:"lines_removed,omitempty"`
	Language     string `json:"language,omitempty"`
	At           int64  `json:"at,omitempty"` // unix epoch ms
}

var safeFilenameRe = regexp.MustCompile(`[^A-Za-z0-9_.-]`)

// path returns the cache file for `sessionID` and `vendor`.
//
// We deliberately partition the cache by vendor as well as session id
// because Claude Code launched inside Cursor inherits Cursor's
// CURSOR_SESSION_ID (and similar env-leakage cases on Codex).
// Without per-vendor partitioning, the first hook to write the cache
// poisons every other vendor's reads — symptoms include:
//
//   - Claude Code spans inheriting Cursor's `composer_mode` value
//     ("agent" / "plan" / "ask"), even though Claude Code never reports
//     those values.
//   - Identical `terminal.type` on both vendors' spans.
//   - User identity flapping between OAuth email (Claude Code) and OS
//     username (Cursor's fallback) within a single chat.
//
// Returns "" when the session id is empty, the vendor is empty, or
// the cache root can't be derived. Every adapter passes its canonical
// vendor; an empty vendor here is a programming error and we refuse
// to write into a shared file that would re-introduce the cross-vendor
// poisoning the partitioning was designed to prevent.
func path(sessionID, vendor string) string {
	if sessionID == "" || vendor == "" {
		return ""
	}
	root, err := os.UserCacheDir()
	if err != nil || root == "" {
		return ""
	}
	safeSID := safeFilenameRe.ReplaceAllString(sessionID, "_")
	safeVendor := safeFilenameRe.ReplaceAllString(vendor, "_")
	if safeSID == "" || safeVendor == "" {
		return ""
	}
	return filepath.Join(root, "openlit", "sessions", safeSID+"__"+safeVendor+".json")
}

// diskMu serialises Load / Save inside a single process. Cross-process
// safety is handled by per-file flock acquired inside withFileLock.
var diskMu sync.Mutex

// withFileLock acquires an exclusive advisory lock on the file at
// `lockPath` and runs fn while holding it. The lock file is created
// next to the cache entry (suffixed `.lock`) so concurrent hook
// processes for the same session serialise on the same descriptor.
//
// On Unix, the real implementation in `flock_unix.go` uses
// `syscall.Flock` for true cross-process serialisation. On Windows
// the stub in `flock_windows.go` falls through to the in-process
// `diskMu` mutex — that's correct for the common single-host case
// and avoids the cgo dance of LockFileEx for what is, today, a Unix-
// first dev tool. Both implementations always invoke `fn` exactly
// once, regardless of whether the lock attempt succeeded — the
// underlying contract is "best-effort serialisation; never block
// the hook".
//
// The platform-specific definitions live in the build-tagged sibling
// files in this package.

// Load returns the cached state for the (sessionID, vendor) pair.
// Always returns a non-nil State even when the cache file is missing
// or unreadable — callers fall through to the empty state and emit
// fresh. See `path` for the rationale on per-vendor partitioning.
func Load(sessionID, vendor string) *State {
	p := path(sessionID, vendor)
	if p == "" {
		return &State{}
	}
	maybeGC()
	out := &State{}
	withFileLock(p+".lock", func() {
		diskMu.Lock()
		defer diskMu.Unlock()
		b, err := os.ReadFile(p)
		if err != nil {
			return
		}
		var s State
		if err := json.Unmarshal(b, &s); err != nil {
			return
		}
		// Touch mtime so frequently-resumed sessions don't get GC'd
		// out from under a long-running chat.
		_ = os.Chtimes(p, time.Now(), time.Now())
		out = &s
	})
	return out
}

// pendingEditCap bounds how many in-flight pending edits a single
// session can hold. Vendors that emit Pre+Post pairs (Claude Code's
// Edit / Write / MultiEdit) typically have <=1 in-flight at a time;
// the cap exists to defend against the pathological case where a hung
// session never drains its pre-edits and the cache grows unbounded.
const pendingEditCap = 32

// AddPendingEdit stashes the proposed edit body under the vendor's
// tool-use id. The function is best-effort and silently drops new
// entries when the cap is hit so the cache cannot grow unbounded.
// Counts as a no-op when the session id or tool-use id is empty.
func AddPendingEdit(sessionID, vendor, toolUseID string, edit *PendingEdit) {
	if sessionID == "" || vendor == "" || toolUseID == "" || edit == nil {
		return
	}
	st := Load(sessionID, vendor)
	if st == nil {
		st = &State{}
	}
	if st.PendingEdits == nil {
		st.PendingEdits = make(map[string]*PendingEdit, 4)
	}
	if _, exists := st.PendingEdits[toolUseID]; !exists && len(st.PendingEdits) >= pendingEditCap {
		// Drop oldest by simple scan; the cap is only hit in the
		// pathological case where Post never fires, so a linear
		// scan is fine.
		var oldestKey string
		var oldestAt int64
		for k, v := range st.PendingEdits {
			if v == nil {
				continue
			}
			if oldestKey == "" || v.At < oldestAt {
				oldestKey = k
				oldestAt = v.At
			}
		}
		if oldestKey != "" {
			delete(st.PendingEdits, oldestKey)
		}
	}
	edit.ToolUseID = toolUseID
	if edit.At == 0 {
		edit.At = time.Now().UnixMilli()
	}
	st.PendingEdits[toolUseID] = edit
	Save(sessionID, vendor, st)
}

// TakePendingEdit removes and returns the pending edit by tool-use id.
// Returns nil when no entry exists. The caller is responsible for
// emitting the resolved EditDecision span / bumping counters; this
// function only owns the cache write.
func TakePendingEdit(sessionID, vendor, toolUseID string) *PendingEdit {
	if sessionID == "" || vendor == "" || toolUseID == "" {
		return nil
	}
	st := Load(sessionID, vendor)
	if st == nil || st.PendingEdits == nil {
		return nil
	}
	got, ok := st.PendingEdits[toolUseID]
	if !ok {
		return nil
	}
	delete(st.PendingEdits, toolUseID)
	Save(sessionID, vendor, st)
	return got
}

// DrainPendingEdits removes and returns all currently-pending edits.
// Called on UserPromptSubmit / SessionEnd to attribute lingering
// Pre-without-Post entries as user rejections.
func DrainPendingEdits(sessionID, vendor string) []*PendingEdit {
	if sessionID == "" || vendor == "" {
		return nil
	}
	st := Load(sessionID, vendor)
	if st == nil || len(st.PendingEdits) == 0 {
		return nil
	}
	out := make([]*PendingEdit, 0, len(st.PendingEdits))
	for _, v := range st.PendingEdits {
		if v != nil {
			out = append(out, v)
		}
	}
	st.PendingEdits = nil
	Save(sessionID, vendor, st)
	return out
}

// BumpCodeCounters accumulates code-change totals onto the cached
// session state. Adapters call this from edit-tool hook handlers;
// the otlp emitter reads the totals on sessionEnd and stamps them on
// the session-root span. The function is a no-op when no deltas are
// supplied so callers don't need to gate the call site.
func BumpCodeCounters(sessionID, vendor string, linesAdded, linesRemoved, linesAccepted, linesRejected, editAccepts, editRejects int) {
	if sessionID == "" || vendor == "" {
		return
	}
	if linesAdded == 0 && linesRemoved == 0 && linesAccepted == 0 && linesRejected == 0 && editAccepts == 0 && editRejects == 0 {
		return
	}
	st := Load(sessionID, vendor)
	if st == nil {
		st = &State{}
	}
	st.LinesAdded += linesAdded
	st.LinesRemoved += linesRemoved
	st.LinesAccepted += linesAccepted
	st.LinesRejected += linesRejected
	st.EditAcceptCount += editAccepts
	st.EditRejectCount += editRejects
	Save(sessionID, vendor, st)
}

// BumpCommitCount bumps the per-session commit counter. Called once
// per agent-attributed `git commit` invocation detected by the
// vendor adapter.
func BumpCommitCount(sessionID, vendor string) {
	if sessionID == "" || vendor == "" {
		return
	}
	st := Load(sessionID, vendor)
	if st == nil {
		st = &State{}
	}
	st.CommitCount++
	Save(sessionID, vendor, st)
}

// BumpPRCount bumps the per-session pull-request counter. Called once
// per agent-attributed PR / MR creation detected by the vendor
// adapter.
func BumpPRCount(sessionID, vendor string) {
	if sessionID == "" || vendor == "" {
		return
	}
	st := Load(sessionID, vendor)
	if st == nil {
		st = &State{}
	}
	st.PRCount++
	Save(sessionID, vendor, st)
}

// Save writes `s` to the cache file for the (sessionID, vendor) pair.
// Best-effort — errors are silent because the hook contract is "never
// fail on telemetry". Uses temp-file + rename to avoid leaving
// half-written JSON behind if another hook process raced us or the OS
// killed us mid-write.
func Save(sessionID, vendor string, s *State) {
	p := path(sessionID, vendor)
	if p == "" || s == nil {
		return
	}
	withFileLock(p+".lock", func() {
		diskMu.Lock()
		defer diskMu.Unlock()
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			return
		}
		b, err := json.Marshal(s)
		if err != nil {
			return
		}
		tmp, err := os.CreateTemp(filepath.Dir(p), filepath.Base(p)+".*")
		if err != nil {
			return
		}
		tmpPath := tmp.Name()
		_, werr := tmp.Write(b)
		cerr := tmp.Close()
		if werr != nil || cerr != nil {
			_ = os.Remove(tmpPath)
			return
		}
		_ = os.Chmod(tmpPath, 0o600)
		if err := os.Rename(tmpPath, p); err != nil {
			_ = os.Remove(tmpPath)
		}
	})
}

// maybeGC runs the on-disk reaper on roughly 1 / gcEvery Load calls so
// the hot path stays cheap. Tests can stub this by zeroing gcEvery.
func maybeGC() {
	if gcEvery <= 0 || rand.Intn(gcEvery) != 0 {
		return
	}
	go GC(gcMaxAge)
}

// GC walks the on-disk cache and removes files (and their .lock
// siblings) whose mtime is older than `maxAge`. Best-effort — errors
// are silent so a partial sweep can't fail the hook process. Exported
// so tests + an optional CLI subcommand can drive it explicitly.
func GC(maxAge time.Duration) {
	root, err := os.UserCacheDir()
	if err != nil || root == "" {
		return
	}
	dir := filepath.Join(root, "openlit", "sessions")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-maxAge)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}
