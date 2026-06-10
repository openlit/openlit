// Package hook implements `openlit coding hook --vendor=... --event=...`.
//
// This is the hot path: invoked once per agent event by the per-vendor
// host plugin manifests under plugins/<vendor>/. The subcommand reads
// the agent's payload from stdin, normalizes it into coding_agent.* OTel
// spans/events via the per-vendor adapters under hook/<vendor>/, and
// exports via internal/otlp.
//
// Crash isolation rules (non-negotiable):
//   - exits 0 on telemetry-path failure (a broken pipe never blocks the dev)
//   - 5s hard timeout on the entire invocation; 3s of that for OTLP flush
//   - panic-recover wraps the body
//   - never writes to stdout (Claude Code parses stdout for JSON)
package hook

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/git"
	"github.com/openlit/openlit/cli/internal/coding/hook/claudecode"
	"github.com/openlit/openlit/cli/internal/coding/hook/codex"
	"github.com/openlit/openlit/cli/internal/coding/hook/cursor"
	"github.com/openlit/openlit/cli/internal/coding/identity"
	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/coding/sessionstate"
	"github.com/openlit/openlit/cli/internal/config"
	"github.com/openlit/openlit/cli/internal/otlp"
	"github.com/spf13/cobra"
)

const (
	// hardTimeout caps the entire hook invocation. Each adapter is
	// expected to finish well under this, but if any part hangs we'd
	// rather drop the data than wedge the agent.
	hardTimeout = 5 * time.Second
	// flushTimeout is reserved at the end for OTLP shutdown/flush.
	flushTimeout = 3 * time.Second
)

// NewCmd returns the cobra command for `openlit coding hook`.
func NewCmd() *cobra.Command {
	var (
		vendor string
		event  string
	)

	cmd := &cobra.Command{
		Use:   "hook",
		Short: "Process a coding-agent hook event (invoked by host plugin manifests)",
		Long: `Process a coding-agent hook event.

Reads the host plugin's payload from stdin, normalizes it to
coding_agent.* OTel spans/events, and exports via OTLP. The subcommand
always exits 0 on telemetry-path failure so a broken telemetry pipeline
never blocks a developer's prompt.`,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return run(cmd, vendor, event)
		},
	}

	cmd.Flags().StringVar(&vendor, "vendor", "", "Vendor: cc | claude-code | cursor | codex")
	cmd.Flags().StringVar(&event, "event", "", "Hook event name (vendor-specific; e.g. SessionStart, PreToolUse)")
	_ = cmd.MarkFlagRequired("vendor")

	return cmd
}

func run(cmd *cobra.Command, vendor, event string) (rerr error) {
	// Top-level recover — we promise to never crash the host agent.
	defer func() {
		if r := recover(); r != nil {
			logErrorf("hook panic: %v\n%s", r, debug.Stack())
			rerr = nil
		}
	}()

	// Canonicalize the vendor key once. Plugin manifests historically
	// invoked `--vendor=cc` (short alias) for Claude Code, while
	// sessionstate / adapters / queries.ts all use `claude-code`. The
	// split produced two on-disk caches per session (one under `cc`,
	// one under `claude-code`) that never merged, breaking identity
	// promotion + parent_id replay across consecutive hook events. We
	// no longer need the alias for back-compat, so collapse it here
	// before any downstream code sees the raw flag.
	vendor = canonicalVendor(vendor)

	ctx, cancel := context.WithTimeout(cmd.Context(), hardTimeout)
	defer cancel()

	// Read the entire payload up-front. Hooks send small JSON blobs
	// (a few KB at most), so buffering is fine and lets adapters work
	// against bytes instead of streaming readers.
	payload, err := io.ReadAll(io.LimitReader(os.Stdin, 8<<20)) // 8 MB cap
	if err != nil {
		logErrorf("hook stdin read: %v", err)
		return nil
	}

	// Optional debug tee. When OPENLIT_DEBUG_PAYLOAD_DIR is set we
	// append the raw inbound payload (with a header line) to
	// <dir>/<vendor>-<event>.jsonl. Off by default; exists for
	// "why isn't my prompt landing?" triage where the only way to
	// know what the vendor sent is to inspect the byte stream they
	// piped to stdin. Kept here rather than behind a flag because
	// it has zero cost when the env var is unset.
	if debugDir := strings.TrimSpace(os.Getenv("OPENLIT_DEBUG_PAYLOAD_DIR")); debugDir != "" {
		_ = teePayload(debugDir, vendor, event, payload)
	}

	// Host-mismatch guard.
	//
	// Cursor 3.4+ ships a Claude Code compatibility shim that reads
	// `~/.claude/plugins/<plugin>/hooks/hooks.json` (and Anthropic's
	// CLAUDE_PLUGIN_ROOT / CLAUDE_PROJECT_DIR env envelope) and
	// invokes those hook commands for ITS OWN agent turns, in
	// addition to firing the native `~/.cursor/plugins/*` hooks. So
	// a user who installed both
	// `openlit coding install --vendor=cursor` AND
	// `--vendor=claude-code` would otherwise get every Cursor chat
	// double-emitted: once with --vendor=cursor (the real Cursor
	// plugin) and once with --vendor=cc (Cursor masquerading as
	// Claude Code through the compat shim). The UI then shows the
	// same chat thread on both vendor detail pages, with the
	// Claude Code row carrying Cursor-shaped events
	// (sessionStart instead of SessionStart, etc.).
	//
	// `isRealClaudeCodeInvocation` returns true ONLY when
	// `CLAUDECODE=1` is set — that's the single env signal Claude
	// Code's own runtime sets on every hook subprocess. Cursor's
	// compat shim deliberately mimics CLAUDE_PROJECT_DIR /
	// CLAUDE_PLUGIN_ROOT but does NOT set CLAUDECODE=1 (because the
	// agent driving the turn is Cursor, not Claude Code). So this
	// guard suppresses every Cursor-shaped event reaching the
	// Claude Code adapter while letting real `claude` CLI events
	// through unchanged. Always exits 0 so the host doesn't notice.
	if isClaudeCodeVendor(vendor) && !isRealClaudeCodeInvocation() {
		return nil
	}

	// Surface allow-listed values from ~/.config/openlit/config.env
	// into the process environment BEFORE adapters read them. Per-vendor
	// adapters call os.Getenv directly (e.g. for the repo allowlist),
	// so without this step a value set in config.env would be invisible
	// to them. Existing env vars take precedence so a user's shell
	// override always wins.
	if err := config.PromoteFileToEnv(); err != nil {
		logErrorf("hook config-file env promote: %v", err)
		// non-fatal — the rest of the hook can still proceed without it
	}

	// Resolve the canonical user identity BEFORE the OTel SDK boots so
	// every resource attribute on every span the process emits carries
	// the same value. Without this, the hub's "Users" tab shows two
	// rows for the same human — one with the OAuth email (when
	// OPENLIT_USER is exported), one with the OS username (the last-
	// resort fallback in resolveLocalUser).
	//
	// Priority (highest first):
	//   1. OPENLIT_USER env var (explicit override, usually exported
	//      by the user's shell rc).
	//   2. Vendor's hook payload (Cursor's `user_email`, etc.).
	//   3. Per-session cache (vendor only emits identity on lifecycle
	//      events; cache survives between hook invocations).
	//   4. Per-vendor authoritative file: ~/.claude.json for Claude
	//      Code, ~/.codex/auth.json's JWT for Codex.
	//   5. `git config user.email` — cross-vendor canonical identity
	//      every developer has set.
	//   6. Falls through to OS username inside the OTel exporter.
	//
	// The resolved identity is also persisted to sessionstate so
	// follow-up events that lack an email field in their payload
	// still emit consistently-labeled spans.
	probe := peekContext(payload)
	sessionID := probe.SessionID
	// Cache is partitioned by (sessionID, vendor) — see sessionstate
	// docs for the cross-vendor poisoning case that motivates this.
	cached := sessionstate.Load(sessionID, vendor)
	resolvedUser := strings.TrimSpace(os.Getenv("OPENLIT_USER"))
	if resolvedUser == "" {
		resolvedUser = probe.User
	}
	if resolvedUser == "" {
		resolvedUser = cached.User
	}
	if resolvedUser == "" {
		resolvedUser = identity.ResolveForVendor(vendor)
	}
	if resolvedUser == "" {
		resolvedUser = identity.FromGitConfig()
	}
	if resolvedUser != "" {
		_ = os.Setenv("OPENLIT_USER", resolvedUser)
		cached.User = resolvedUser
	}

	// Working folder, permission mode, and VCS snapshot — sticky
	// session-level facts the trace-detail header expects on every
	// span, even on a tool-call or llm.turn that doesn't itself carry
	// them. We cache the first sighting and replay it as a resource
	// attribute so child spans inherit the session's context. The
	// CLI is short-lived (one process per hook event) so resource
	// attrs are scoped to a single event, which is what we want.
	if probe.CWD != "" {
		cached.CWD = probe.CWD
	}
	// Detect permission-mode and model transitions BEFORE we overwrite
	// the cached values, then emit a small change event so the UI can
	// chart "developer toggled from agent → plan" or "model swapped"
	// for any of the three coding agents (Cursor exposes this as
	// composer_mode, Claude Code as permission_mode, Codex as
	// approval_mode — all collapsed in peekContext into PermissionMode).
	// We need to emit BEFORE OTLP boots so we wait — see the
	// post-emitter detectModeChanges call below.
	prevMode := cached.PermissionMode
	prevModel := cached.Model
	if probe.PermissionMode != "" {
		cached.PermissionMode = probe.PermissionMode
	}
	if probe.Model != "" {
		cached.Model = probe.Model
	}
	if probe.ConversationID != "" {
		cached.ConversationID = probe.ConversationID
	}
	if probe.ParentConversationID != "" {
		cached.ParentConversationID = probe.ParentConversationID
	}
	if probe.IsBackgroundAgent {
		cached.IsBackgroundAgent = true
	}
	// Git snapshot is best-effort: we only run it if we have a CWD
	// (either from the payload or from the cache) AND the cache
	// hasn't already populated it. `git remote -v` per hook event
	// would be wasteful, so the first hook for a session pays the
	// snapshot cost and subsequent hooks read the cached value.
	// Cursor only sends `workspace_roots` on session lifecycle and
	// prompt events; the per-tool / per-edit hooks come in without
	// any CWD field. We fall back to the process cwd (the editor
	// launches the hook from the workspace root) and — critically —
	// persist that fallback so subsequent hook events in the same
	// session don't keep re-resolving it. Without this persistence,
	// the trace-detail "Working Folder" + "Repository" pills stay
	// empty on every non-lifecycle span.
	if cached.CWD == "" {
		if wd, err := os.Getwd(); err == nil && wd != "" && wd != "/" {
			cached.CWD = wd
		}
	}
	if cached.CWD != "" && (cached.RepoURL == "" || cached.Branch == "") {
		vcs := git.Snapshot(ctx, cached.CWD)
		if vcs.RepoURL != "" {
			cached.RepoURL = vcs.RepoURL
		}
		if vcs.Branch != "" {
			cached.Branch = vcs.Branch
		}
	}
	if sessionID != "" && (cached.User != "" || cached.CWD != "" ||
		cached.PermissionMode != "" || cached.Model != "" ||
		cached.RepoURL != "" || cached.Branch != "" ||
		cached.ConversationID != "" || cached.ParentConversationID != "" ||
		cached.IsBackgroundAgent) {
		sessionstate.Save(sessionID, vendor, cached)
	}

	cfg, err := config.Load(nil)
	if err != nil {
		logErrorf("hook config load: %v", err)
		return nil
	}

	adapter, err := pickAdapter(vendor)
	if err != nil {
		logErrorf("hook adapter: %v", err)
		return nil
	}

	// Default service.name to the vendor identifier ("cursor",
	// "claude-code", "codex") so the trace-detail header's
	// SERVICE pill matches Claude Code's monitoring convention and
	// the per-vendor materializer can group by service.name. The
	// user-set OPENLIT_APPLICATION_NAME (file or env) still wins;
	// only the implicit default is overridden.
	if src := cfg.Source["application_name"]; src == "default" || src == "" {
		if v := adapter.Vendor(); v != "" {
			cfg.ApplicationName = v
			cfg.Source["application_name"] = "vendor-default"
		}
	}

	// Stamp session-level facts on every span this process emits.
	// This is what makes the trace-detail header pills (Working
	// Folder, Repository, Branch, Mode) stay populated even when
	// the developer drills into a child span (llm.turn, tool.call)
	// that doesn't itself carry these attributes.
	sessionAttrs := map[string]string{}
	if cached.CWD != "" {
		sessionAttrs["code.cwd"] = cached.CWD
	}
	if cached.RepoURL != "" {
		sessionAttrs["vcs.repository.url.full"] = cached.RepoURL
	}
	if cached.Branch != "" {
		sessionAttrs["vcs.ref.head.name"] = cached.Branch
	}
	if cached.PermissionMode != "" {
		sessionAttrs["coding_agent.policy.permission_mode"] = cached.PermissionMode
	}
	if sessionID != "" {
		sessionAttrs["coding_agent.session.id"] = sessionID
	}
	// Conversation id — vendor's chat-thread identifier, distinct
	// from session_id on Cursor (and equal on most others). Stamping
	// it as a resource attribute lets the UI roll up by chat thread
	// without depending on the session-root span carrying it.
	if cached.ConversationID != "" {
		sessionAttrs["gen_ai.conversation.id"] = cached.ConversationID
	}
	// Parent linkage — when this hook process is running inside a
	// subagent that knows its parent's chat id, stamp it so the UI
	// can fold the subagent's spans under the parent's chat row
	// instead of listing the subagent as a separate session.
	if cached.ParentConversationID != "" {
		sessionAttrs["coding_agent.agent.parent_id"] = cached.ParentConversationID
	}
	// Subagent flag — toggled by Cursor's is_background_agent /
	// is_parallel_worker on subagent payloads. Used by the Sessions
	// list to default-hide subagents from the main view.
	if cached.IsBackgroundAgent {
		sessionAttrs["coding_agent.session.is_subagent"] = "true"
	}
	// Promote the cached terminal/host (set by Claude Code's
	// transcript `entrypoint` on a previous event in the same
	// session) to a resource attribute so every span — including the
	// session-root span emitted on SessionStart — agrees on the host.
	// Wins over env / process-tree detection in the OTel exporter
	// because Claude Code's own self-report is the most reliable
	// signal.
	if cached.TerminalType != "" {
		sessionAttrs["terminal.type"] = cached.TerminalType
	}
	// Capture mode — clarifies in audit logs which mode the session
	// was recorded under. Stamped from the CLI config; downstream
	// consumers (the disputes UI, eDiscovery) can rely on this
	// without having to infer from the presence/absence of bodies.
	if mode := strings.TrimSpace(cfg.CodingContentCapture); mode != "" {
		sessionAttrs["coding_agent.content_capture_mode"] = mode
	}

	emit, err := otlp.NewEmitter(ctx, cfg, adapter.Vendor(), sessionAttrs)
	if err != nil {
		logErrorf("hook otlp init: %v", err)
		return nil
	}
	defer func() {
		fctx, fcancel := context.WithTimeout(context.Background(), flushTimeout)
		defer fcancel()
		if ferr := emit.Shutdown(fctx); ferr != nil {
			logErrorf("hook otlp shutdown: %v", ferr)
		}
	}()

	// Emit cross-vendor change events for permission_mode and model.
	// We do this AFTER the emitter is initialised but BEFORE the
	// per-vendor adapter runs, so the change event is the first thing
	// the trace carries when the same hook event also pulls in a new
	// turn span. The check skips informational "first sighting" cases
	// (prev == "") so the timeline doesn't get spammed with a fake
	// "transition" on every SessionStart.
	if sessionID != "" {
		if probe.PermissionMode != "" && prevMode != "" && probe.PermissionMode != prevMode {
			_ = emit.EmitEvent(normalize.EventEmission{
				SessionID: sessionID,
				Name:      "coding_agent.session.permission_mode.changed",
				At:        time.Now(),
				Attrs: map[string]any{
					"coding_agent.client":                       adapter.Vendor(),
					"coding_agent.hook.event":                   event,
					"coding_agent.session.permission_mode.from": prevMode,
					"coding_agent.session.permission_mode.to":   probe.PermissionMode,
				},
			})
		}
		if probe.Model != "" && prevModel != "" && probe.Model != prevModel {
			_ = emit.EmitEvent(normalize.EventEmission{
				SessionID: sessionID,
				Name:      "coding_agent.session.model.changed",
				At:        time.Now(),
				Attrs: map[string]any{
					"coding_agent.client":             adapter.Vendor(),
					"coding_agent.hook.event":         event,
					"coding_agent.session.model.from": prevModel,
					"coding_agent.session.model.to":   probe.Model,
					"gen_ai.request.model":            probe.Model,
				},
			})
		}
	}

	if err := adapter.Handle(ctx, normalize.Input{
		Vendor:         adapter.Vendor(),
		Event:          event,
		Payload:        payload,
		ContentCapture: cfg.CodingContentCapture,
		Emit:           emit,
	}); err != nil {
		logErrorf("hook adapter handle: %v", err)
	}

	// Always succeed back to the agent.
	return nil
}

// canonicalVendor folds the various vendor aliases the plugin manifests
// have used historically (`cc`, `claudecode`, `claude_code`, …) onto
// the canonical names used everywhere else: `cursor`, `claude-code`,
// `codex`. Returns the input unchanged when it's already canonical or
// unrecognized — pickAdapter then surfaces the unknown-vendor error.
// Empty input is preserved so the "--vendor required" error fires as
// before.
func canonicalVendor(vendor string) string {
	v := strings.ToLower(strings.TrimSpace(vendor))
	switch v {
	case "cc", "claude-code", "claudecode", "claude_code":
		return "claude-code"
	case "cursor":
		return "cursor"
	case "codex":
		return "codex"
	default:
		return v
	}
}

// pickAdapter resolves the (already-canonicalized) vendor key to a
// hook adapter. Aliases were folded by canonicalVendor at run() entry,
// so this switch only needs the canonical names.
func pickAdapter(vendor string) (normalize.Adapter, error) {
	switch vendor {
	case "claude-code":
		return claudecode.New(), nil
	case "cursor":
		return cursor.New(), nil
	case "codex":
		return codex.New(), nil
	case "":
		return nil, errors.New("--vendor is required")
	default:
		return nil, fmt.Errorf("unknown --vendor %q", vendor)
	}
}

// isClaudeCodeVendor returns true when the vendor key resolves to the
// Claude Code adapter. Accepts any of the historical aliases the host
// plugins have used (`cc`, `claudecode`, `claude_code`, …) so callers
// can pass the raw --vendor flag without pre-canonicalising.
func isClaudeCodeVendor(vendor string) bool {
	return canonicalVendor(vendor) == "claude-code"
}

// isRealClaudeCodeInvocation returns true when the current process was
// spawned by an actual Claude Code agent runtime (not by a host that
// happens to honour Claude Code's hook spec, e.g. Cursor 3.4+).
//
// Detection rule (intentionally strict):
//
//	A real Claude Code hook subprocess ALWAYS has `CLAUDECODE=1`
//	in its environment — this is documented at
//	code.claude.com/docs/en/hooks and observed unconditionally in
//	practice. We treat that single variable as the authoritative
//	positive signal.
//
// We deliberately do NOT key off `CLAUDE_PROJECT_DIR` or
// `CLAUDE_SESSION_ID` even though Anthropic's own docs list them —
// Cursor 3.4+ ships a Claude Code compatibility shim that reads
// `~/.claude/plugins/<plugin>/hooks/hooks.json` and invokes the bundled
// hook command for *Cursor's own* agent turns. That shim mirrors
// Anthropic's `CLAUDE_*` envelope (including `CLAUDE_PROJECT_DIR` and
// `CLAUDE_PLUGIN_ROOT`) so the plugin "just works" — but `CLAUDECODE=1`
// is NEVER set, because the agent talking to the LLM is Cursor, not
// Claude Code. Captured env from a real Cursor 3.4.17 masquerade:
//
//	CLAUDE_PROJECT_DIR=/Users/.../.claude/plugins/cache/openlit/openlit-cc/0.1.0
//	CLAUDE_PLUGIN_ROOT=/Users/.../.claude/plugins/cache/openlit/openlit-cc/0.1.0
//	CURSOR_VERSION=3.4.17
//	CURSOR_PLUGIN_ROOT=/Users/.../.claude/plugins/cache/openlit/openlit-cc/0.1.0
//	CURSOR_USER_EMAIL=...
//	CURSOR_LAYOUT=unifiedAgent
//	CURSOR_EXTENSION_HOST_ROLE=always-local
//	(CLAUDECODE is unset)
//
// Anchoring on `CLAUDECODE=1` makes the masquerade detection
// configuration-free — we don't have to keep chasing the set of
// `CURSOR_*` markers Cursor decides to set on hook subprocesses in
// future releases. It also makes the rule symmetric for hypothetical
// future hosts that honour the Claude Code plugin spec: only the real
// thing gets through.
func isRealClaudeCodeInvocation() bool {
	return strings.TrimSpace(os.Getenv("CLAUDECODE")) == "1"
}

// logErrorf writes to stderr only. Stdout is reserved for the agent's
// own JSON channel (Claude Code in particular parses stdout); writing
// to it from a hook can corrupt the session.
func logErrorf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "openlit hook: "+format+"\n", args...)
}

// teePayload appends `payload` (and a small header line) to a
// per-(vendor,event) jsonl file under dir. Used purely for "what is
// the vendor actually sending us?" triage when content fields appear
// to be missing on the resulting spans. Errors are swallowed: this
// is debug code, never on the hot path. The header doubles as a
// jsonl pre-line so readers can ignore non-JSON lines easily.
func teePayload(dir, vendor, event string, payload []byte) error {
	// 0o700 mirrors the file-mode tightening below; otherwise a
	// freshly-created debug directory would briefly be world-
	// listable, leaking the (vendor, event) tuples even if the
	// payload files are 0o600.
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	name := fmt.Sprintf("%s-%s.jsonl", vendor, event)
	// 0o600: these payloads frequently contain prompt bodies, file
	// paths under the user's home, and (despite tier-1 redaction)
	// the occasional unredacted token. Keep them owner-readable
	// only so a shared developer workstation doesn't leak between
	// accounts.
	f, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	fmt.Fprintf(f, "--- %s vendor=%s event=%s bytes=%d ---\n", time.Now().UTC().Format(time.RFC3339Nano), vendor, event, len(payload))
	_, _ = f.Write(payload)
	if len(payload) == 0 || payload[len(payload)-1] != '\n' {
		_, _ = f.Write([]byte("\n"))
	}
	return nil
}

// peekedContext is the vendor-agnostic slice of facts we extract from a
// hook payload BEFORE the OTel SDK is initialised, so we can stamp them
// as resource attributes on every span this process emits. Adapters
// later populate the typed payload onto per-span attributes; this
// preflight is purely for resource-level stickiness.
type peekedContext struct {
	SessionID            string
	ConversationID       string
	ParentConversationID string
	User                 string
	CWD                  string
	PermissionMode       string
	Model                string
	IsBackgroundAgent    bool
}

// peekContext scans a hook payload for session id, user identity,
// working folder, permission mode, and model using a small set of
// well-known JSON keys. All fields can be empty — callers handle the
// fallbacks (sessionstate cache, env vars, OS context).
func peekContext(payload []byte) peekedContext {
	out := peekedContext{}
	if len(payload) == 0 {
		return out
	}
	var probe map[string]any
	if err := json.Unmarshal(payload, &probe); err != nil {
		return out
	}
	pickString := func(keys ...string) string {
		for _, k := range keys {
			v, ok := probe[k]
			if !ok {
				continue
			}
			if s, ok := v.(string); ok {
				s = strings.TrimSpace(s)
				if s != "" {
					return s
				}
			}
		}
		return ""
	}
	out.SessionID = pickString("session_id", "conversation_id", "sessionId", "thread_id")
	// Distinct conversation id (when the vendor reports one) — this is
	// what survives subagent spawns and, on a few vendors, IDE
	// restarts. UI uses it as the rollup key in preference to
	// session_id so multi-process chats fold into one row.
	out.ConversationID = pickString("conversation_id", "conversationId", "thread_id", "threadId")
	// `parent_conversation_id` is Cursor's link from a subagent back
	// to its parent chat thread. When present we promote it to a
	// resource attribute so every span the subagent emits carries
	// the parent's id, and the UI can roll the subagent up under
	// the chat that spawned it.
	out.ParentConversationID = pickString("parent_conversation_id", "parentConversationId", "parent_session_id")
	// Cursor exposes `user_email` on every event that carries
	// identity (sessionStart, beforeSubmitPrompt, sessionEnd, ...).
	// Claude Code transcript hooks include the user-message author
	// email; Codex rollouts surface a similar field. We accept any
	// of these so adding new vendors stays mechanical.
	out.User = pickString("user_email", "user_id", "user", "author_email", "actor_email", "identity")
	// Cursor calls it `cwd`; Claude Code sets the env CLAUDE_PROJECT_DIR
	// (handled by resolveTerminalType, not the payload). For the
	// payload path we accept either.
	out.CWD = pickString("cwd", "working_directory", "workingDirectory")
	if out.CWD == "" {
		// Cursor sometimes only sends `workspace_roots: []`. Pick
		// the first entry as a best-effort cwd.
		if v, ok := probe["workspace_roots"]; ok {
			if arr, ok := v.([]any); ok && len(arr) > 0 {
				if s, ok := arr[0].(string); ok {
					out.CWD = strings.TrimSpace(s)
				}
			}
		}
	}
	// Permission mode is the same concept under three different
	// names across vendors:
	//   - Cursor:      composer_mode       ("agent" | "plan" | "ask")
	//   - Claude Code: permission_mode     ("default" | "acceptEdits" | "bypassPermissions" | "plan")
	//   - Codex:       approval_mode       ("untrusted" | "on-failure" | "on-request" | "never")
	// We coalesce all of them into the canonical
	// coding_agent.policy.permission_mode resource attribute so the
	// UI can chart mode toggles with one query.
	out.PermissionMode = pickString(
		"composer_mode",
		"permission_mode", "permissionMode",
		"approval_mode", "approvalMode",
	)
	out.Model = pickString("model", "request_model", "requestModel")
	if v, ok := probe["is_background_agent"]; ok {
		if b, ok := v.(bool); ok {
			out.IsBackgroundAgent = b
		}
	}
	if !out.IsBackgroundAgent {
		if v, ok := probe["is_parallel_worker"]; ok {
			if b, ok := v.(bool); ok && b {
				// Parallel workers are background agents in
				// every dashboard we care about; collapse the
				// flag so the UI doesn't need to know both.
				out.IsBackgroundAgent = true
			}
		}
	}
	return out
}
