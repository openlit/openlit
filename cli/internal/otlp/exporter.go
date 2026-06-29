// Package otlp wraps the sdk/go OTel exporter for the CLI's hot path.
//
// Lifecycle (per hook invocation):
//
//	emitter, err := otlp.NewEmitter(ctx, cfg)
//	... emit spans/events ...
//	emitter.Shutdown(ctxWithFlushBudget)
//
// The emitter implements the normalize.Emitter interface so per-vendor
// adapters under hook/<vendor>/ stay decoupled from OTel mechanics.
//
// NOTE: There is currently no disk-backed retry queue. The
// `emitter.Shutdown(ctxWithFlushBudget)` call has a few-hundred-ms
// flush budget; if the collector is unreachable past that window the
// spans are dropped on the floor. This is the single biggest gap
// Phase D8 covers wiring an OTel BatchSpanProcessor with
// real retry + a XDG-cached fallback queue.
package otlp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/user"
	"strings"
	"sync"
	"time"

	"github.com/openlit/openlit/cli/internal/coding/normalize"
	"github.com/openlit/openlit/cli/internal/coding/sessionstate"
	"github.com/openlit/openlit/cli/internal/config"
	"github.com/openlit/openlit/cli/internal/redact"
	"github.com/openlit/openlit/cli/internal/version"
	openlit "github.com/openlit/openlit/sdk/go"
	"github.com/openlit/openlit/sdk/go/semconv"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// drainCounters reads the minimal-mode rolled-up counters off the
// sessionstate cache (scoped to the emitting vendor) and merges them
// into the session struct, preferring caller-supplied values when
// present. We DO NOT clear the counters from disk — sessionEnd may
// run multiple times across retry, and the GC routine in sessionstate
// handles eventual cleanup.
//
// Split into two functions because the LOC / edit / commit / PR
// counters are bumped regardless of capture mode (a Cursor user on
// metadata capture still wants to see their LOC numbers); the
// tool-call / token / cost counters only need draining in minimal
// mode where their per-event spans were suppressed.
func drainCounters(s normalize.Session, vendor string) normalize.Session {
	if s.SessionID == "" {
		return s
	}
	st := sessionstate.Load(s.SessionID, vendor)
	if st == nil {
		return s
	}
	if s.ToolCallCount == 0 && st.ToolCallCount > 0 {
		s.ToolCallCount = st.ToolCallCount
	}
	if s.SubagentCount == 0 && st.SubagentCount > 0 {
		s.SubagentCount = st.SubagentCount
	}
	if s.InputTokens == 0 && st.InputTokens > 0 {
		s.InputTokens = st.InputTokens
	}
	if s.OutputTokens == 0 && st.OutputTokens > 0 {
		s.OutputTokens = st.OutputTokens
	}
	if s.CostUSD == 0 && st.CostUSD > 0 {
		s.CostUSD = st.CostUSD
	}
	if s.TotalTokens == 0 {
		s.TotalTokens = s.InputTokens + s.OutputTokens
	}
	return s
}

// drainCodeCounters folds the cached LOC / edit / commit / PR
// counters onto the session struct, regardless of capture mode.
// Called from every EmitSession invocation so the session-root span
// carries the up-to-the-event totals even when the operator runs in
// `metadata_only` or `full` capture.
func drainCodeCounters(s normalize.Session, vendor string) normalize.Session {
	if s.SessionID == "" {
		return s
	}
	st := sessionstate.Load(s.SessionID, vendor)
	if st == nil {
		return s
	}
	if s.LinesAdded == 0 && st.LinesAdded > 0 {
		s.LinesAdded = st.LinesAdded
	}
	if s.LinesRemoved == 0 && st.LinesRemoved > 0 {
		s.LinesRemoved = st.LinesRemoved
	}
	if s.LinesAccepted == 0 && st.LinesAccepted > 0 {
		s.LinesAccepted = st.LinesAccepted
	}
	if s.LinesRejected == 0 && st.LinesRejected > 0 {
		s.LinesRejected = st.LinesRejected
	}
	if s.EditAcceptCount == 0 && st.EditAcceptCount > 0 {
		s.EditAcceptCount = st.EditAcceptCount
	}
	if s.EditRejectCount == 0 && st.EditRejectCount > 0 {
		s.EditRejectCount = st.EditRejectCount
	}
	if s.CommitCount == 0 && st.CommitCount > 0 {
		s.CommitCount = st.CommitCount
	}
	if s.PRCount == 0 && st.PRCount > 0 {
		s.PRCount = st.PRCount
	}
	return s
}

// resolveLocalUser produces a stable identifier for the human running
// the agent. The hook subcommand resolves the canonical identity via
// `coding/identity.ResolveForVendor` + `FromGitConfig` BEFORE booting
// the OTel SDK and writes the result back into `OPENLIT_USER`, so this
// function is normally a single env-var read.
//
// The OS-username fallback exists for direct CLI usage outside the
// hook hot path (e.g. `openlit configure`); it is the last resort and
// will produce a "Username" row in the hub when no email-shaped
// identity is available.
func resolveLocalUser() string {
	for _, env := range []string{"OPENLIT_USER", "GIT_AUTHOR_EMAIL", "USER_EMAIL"} {
		if v := strings.TrimSpace(os.Getenv(env)); v != "" {
			return v
		}
	}
	if u, err := user.Current(); err == nil {
		if u.Username != "" {
			return u.Username
		}
	}
	for _, env := range []string{"USER", "USERNAME", "LOGNAME"} {
		if v := strings.TrimSpace(os.Getenv(env)); v != "" {
			return v
		}
	}
	return ""
}

// resolveTerminalType detects the IDE / terminal that HOSTS the agent
// — not the agent itself. `terminal.type` mirrors Claude Code's standard
// attribute (https://code.claude.com/docs/en/monitoring-usage#standard-attributes)
// and is supposed to identify the SHELL/IDE in which the agent runs
// (e.g. `vscode`, `cursor`, `iterm`, `tmux`). The agent identifier
// already lives on `coding_agent.client` / `gen_ai.agent.name`, so
// stamping the agent here would be double-counting and breaks
// "which IDE drives the most agent usage" dashboards.
//
// Detection order: most-specific host signal → terminal-program fallback.
// Returns "" if we can't tell — the attribute is then omitted entirely.
func resolveTerminalType() string {
	// Cursor IDE: set by Cursor's editor process. CURSOR_TRACE_ID is
	// only set inside Cursor's hook runner; the other CURSOR_* envs
	// (CURSOR_AGENT, CURSOR_WORKSPACE_LABEL, CURSOR_EXTENSION_HOST_ROLE)
	// are set by Cursor's extension host whenever Cursor is the
	// foreground IDE. Any of them indicates the host is Cursor IDE
	// (regardless of which agent — Claude Code, Cursor Composer,
	// Codex, etc. — is the one calling us).
	for _, env := range []string{
		"CURSOR_TRACE_ID",
		"CURSOR_AGENT",
		"CURSOR_PID",
		"CURSOR_USER",
		"CURSOR_WORKSPACE_LABEL",
		"CURSOR_EXTENSION_HOST_ROLE",
	} {
		if os.Getenv(env) != "" {
			return "cursor"
		}
	}
	// VS Code (and forks). VSCODE_IPC_HOOK is the per-session UDS path
	// containing the IDE's data-dir name — for Cursor it's
	// `/Library/Application Support/Cursor/...`, for VS Code it's
	// `/Library/Application Support/Code/...`. Inspecting the path
	// disambiguates VS Code from forks that also export `VSCODE_PID`.
	ipc := os.Getenv("VSCODE_IPC_HOOK")
	if strings.Contains(ipc, "/Cursor/") || strings.Contains(ipc, "/cursor/") {
		return "cursor"
	}
	if strings.Contains(ipc, "/Code/") || strings.Contains(ipc, "/Code - Insiders/") ||
		strings.Contains(ipc, "/VSCodium/") {
		return "vscode"
	}
	if os.Getenv("VSCODE_PID") != "" || os.Getenv("VSCODE_INJECTION") != "" {
		return "vscode"
	}
	// Codex CLI agents — these run in a real terminal, so we still
	// fall through to TERM_PROGRAM below when its marker isn't
	// present. We don't stamp the agent itself as the
	// terminal.
	// JetBrains IDEs set TERMINAL_EMULATOR=JetBrains-JediTerm.
	if strings.Contains(strings.ToLower(os.Getenv("TERMINAL_EMULATOR")), "jetbrains") {
		return "jetbrains"
	}
	// TERM_PROGRAM is the host terminal app — usable when neither
	// Cursor nor VS Code is involved (plain shell sessions).
	if v := strings.ToLower(os.Getenv("TERM_PROGRAM")); v != "" {
		switch v {
		case "vscode":
			// VS Code sets this; Cursor also sets it (it's a VS Code
			// fork) but Cursor is caught above by CURSOR_* / IPC path.
			return "vscode"
		case "iterm.app":
			return "iterm"
		case "apple_terminal":
			return "apple-terminal"
		case "warpterminal":
			return "warp"
		case "ghostty":
			return "ghostty"
		case "wezterm":
			return "wezterm"
		case "alacritty":
			return "alacritty"
		case "kitty":
			return "kitty"
		case "tabby":
			return "tabby"
		default:
			return v
		}
	}
	if os.Getenv("TMUX") != "" {
		return "tmux"
	}
	// Last resort: walk the process tree. Anthropic Claude Code
	// scrubs IDE-specific env vars when it spawns hook subprocesses,
	// so neither CURSOR_* nor VSCODE_* are visible — but the parent
	// process binary path still reveals the host IDE. Cheap: at most
	// ~10 `ps` lookups per cold-start hook (we cap recursion depth).
	if host := detectHostFromProcessTree(); host != "" {
		return host
	}
	return ""
}

// detectHostFromProcessTree walks up `os.Getppid()` looking for a
// known IDE / terminal binary in the process's argv[0]. Returns "" if
// nothing is recognised within `maxDepth` hops. Bounded so a forked
// daemon tree can't blow up the hook latency.
func detectHostFromProcessTree() string {
	const maxDepth = 12
	pid := os.Getppid()
	for i := 0; pid > 1 && i < maxDepth; i++ {
		name, parent, err := readProcessNameAndPPID(pid)
		if err != nil {
			return ""
		}
		if h := detectHostFromBinary(name); h != "" {
			return h
		}
		pid = parent
	}
	return ""
}

// detectHostFromBinary maps an absolute binary path / argv[0] to a
// known IDE/terminal label. Case-insensitive substring matching keeps
// the map small. Patterns cover all three supported OSes:
//
//   - macOS uses .app bundle paths ("/Cursor.app/Contents/MacOS/Cursor")
//   - Linux uses lowercase binary names ("/usr/bin/cursor", "wezterm")
//   - Windows uses .exe basenames ("Cursor.exe", "Code.exe", "wt.exe")
//
// The lowercase + substring strategy means a single check usually
// matches across all three (e.g. "cursor" appears in every Cursor
// host path).
func detectHostFromBinary(bin string) string {
	b := strings.ToLower(bin)
	switch {
	case strings.Contains(b, "/cursor.app/"),
		strings.Contains(b, "/cursor helper"),
		strings.Contains(b, "cursor.exe"),
		// Plain "cursor" appears in Linux package paths and the
		// Windows AppData install dir alike. Anchored to a path
		// or extension marker to avoid false positives on words
		// like "cursorless".
		strings.Contains(b, "\\cursor\\"),
		strings.Contains(b, "/cursor/"):
		return "cursor"
	case strings.Contains(b, "/visual studio code.app/"),
		strings.Contains(b, "/code helper"),
		strings.Contains(b, "/vscodium"),
		strings.Contains(b, "\\code.exe"),
		strings.Contains(b, "\\vscodium.exe"):
		return "vscode"
	case strings.Contains(b, "/iterm.app/"), strings.Contains(b, "iterm2"):
		return "iterm"
	case strings.Contains(b, "/terminal.app/"):
		return "apple-terminal"
	case strings.Contains(b, "/warp.app/"), strings.Contains(b, "warp.exe"):
		return "warp"
	case strings.Contains(b, "/ghostty.app/"), strings.Contains(b, "ghostty.exe"):
		return "ghostty"
	case strings.Contains(b, "wezterm"):
		return "wezterm"
	case strings.Contains(b, "alacritty"):
		return "alacritty"
	case strings.Contains(b, "kitty"):
		return "kitty"
	case strings.Contains(b, "windowsterminal.exe"), strings.Contains(b, "\\wt.exe"):
		return "windows-terminal"
	case strings.Contains(b, "powershell.exe"), strings.Contains(b, "pwsh.exe"):
		return "powershell"
	case strings.Contains(b, "\\cmd.exe"):
		return "cmd"
	case strings.Contains(b, "/idea.app/"),
		strings.Contains(b, "/intellij idea.app/"),
		strings.Contains(b, "/pycharm.app/"),
		strings.Contains(b, "/goland.app/"),
		strings.Contains(b, "/webstorm.app/"),
		strings.Contains(b, "idea64.exe"),
		strings.Contains(b, "pycharm64.exe"),
		strings.Contains(b, "goland64.exe"),
		strings.Contains(b, "webstorm64.exe"):
		return "jetbrains"
	}
	return ""
}

// readProcessNameAndPPID returns argv[0] and the parent pid for `pid`.
// macOS: shells out to `ps -o ppid=,command= -p <pid>`. Linux: reads
// /proc/<pid>/stat for ppid and /proc/<pid>/cmdline for argv[0]. The
// implementation is intentionally tolerant — any failure short-circuits
// the walk so a non-readable process can never crash the hook.
func readProcessNameAndPPID(pid int) (binary string, ppid int, err error) {
	return readProcessNameAndPPIDOS(pid)
}

// Emitter is the concrete normalize.Emitter implementation. The CLI keeps
// it tiny — sdk/go does the heavy lifting (resource attrs, batch span
// processor, OTLP HTTP client).
type Emitter struct {
	tracer trace.Tracer
	cfg    *config.Resolved

	// vendor is the canonical vendor identifier ("cursor",
	// "claude-code", "codex") for the agent that fired
	// this hook. Mixed into the deterministic TraceID/SpanID so
	// nested agents (e.g. Claude Code launched inside a Cursor
	// terminal) get distinct traces even when the host's session id
	// leaks into the guest's environment.
	vendor string

	// scrub is the active redactor (tier 1 always; tier 2 when the
	// configured content-capture mode is "full"). Wraps every string
	// attribute the adapter passes us so secrets don't leak even
	// when content capture is opt-in.
	scrub func(string) string

	mu        sync.Mutex
	shut      bool
	startedAt time.Time
}

// initOnce guards Init/Shutdown across multiple hook invocations within
// the same process. In practice the CLI's cold-start pattern means each
// invocation is a fresh process; the guard is defense in depth.
var initOnce sync.Mutex

// NewEmitter initializes the OTel SDK and returns an emitter. Callers
// MUST call Shutdown once they're done so spans flush before the
// process exits.
//
// `vendor` is the canonical agent identifier ("cursor", "claude-code",
// "codex"). It's mixed into the deterministic TraceID so
// nested agents (Claude Code inside Cursor's terminal) get distinct
// traces.
//
// `extraAttrs` are merged into the resource bundle on top of the
// default identity / hostname / terminal attributes. Callers (hook.go)
// pass session-level facts here — working folder, repo URL, branch,
// permission mode — so child spans inherit them as resource attributes
// and the trace-detail header pills stay populated when a developer
// drills into a non-session span.
func NewEmitter(_ context.Context, cfg *config.Resolved, vendor string, extraAttrs ...map[string]string) (*Emitter, error) {
	if cfg == nil {
		return nil, errors.New("nil config")
	}

	initOnce.Lock()
	defer initOnce.Unlock()

	if openlit.IsInitialized() {
		// Re-use the existing tracer if Init has already been called.
		// Sane behavior for the rare in-process retry case.
		return &Emitter{
			tracer:    otel.GetTracerProvider().Tracer("openlit-cli"),
			cfg:       cfg,
			vendor:    vendor,
			scrub:     redact.ForCapture(cfg.CodingContentCapture),
			startedAt: time.Now(),
		}, nil
	}

	// Build a resource-attribute set that rides on every span this
	// process emits. We always tag the local user identity (so the
	// dashboard's user roll-ups render something recognisable even
	// when the vendor's hook payload doesn't carry an email), and we
	// stamp a host name + the active vendor for filtering.
	extra := map[string]string{}
	if u := resolveLocalUser(); u != "" {
		extra["gen_ai.user.name"] = u
	}
	if hn, err := os.Hostname(); err == nil && hn != "" {
		extra["host.name"] = hn
	}
	if t := resolveTerminalType(); t != "" {
		// Matches Claude Code's standard attribute so a multi-vendor
		// fleet's `terminal.type` filter has consistent values.
		extra["terminal.type"] = t
	}
	// Caller-supplied attributes win; this lets hook.go layer in
	// session-scoped values without us having to reach back into
	// sessionstate from the exporter package (which would create a
	// circular import in v2 when sessionstate moves alongside the
	// per-vendor adapters).
	for _, m := range extraAttrs {
		for k, v := range m {
			if v == "" {
				continue
			}
			extra[k] = v
		}
	}

	// D5: stamp the CLI version on every span as a resource attribute
	// so operations can correlate behaviour with the binary that
	// produced it (e.g. "this regression appeared in 0.5.3"). The
	// SDK already sets `service.version`; we keep that as the SDK's
	// version and add `coding_agent.hook.cli.version` for the hook
	// binary's identity, which can drift from service.version when a
	// host runs multiple CLIs side-by-side.
	if extra == nil {
		extra = map[string]string{}
	}
	extra["coding_agent.hook.cli.version"] = version.Version
	// Stamp the build commit SHA when available so support can pin a
	// reported behaviour to an exact CLI build. The release workflow
	// passes the short SHA via -ldflags; `dev` / source builds may
	// leave this empty.
	if version.Commit != "" {
		extra["coding_agent.hook.cli.commit"] = version.Commit
	}
	// Mark every span emitted from the hook path so the query layer
	// can tell hook spans apart from a vendor's native OTel exporter
	// (e.g. Claude Code's `CLAUDE_CODE_ENABLE_TELEMETRY=1` path). See
	// `.cursor/rules/coding-agents-convention.mdc` §6 for the full
	// dual-path coalesce contract; without this stamp, reads can't
	// reliably prefer native cost/tokens over our hook estimates.
	extra["coding_agent.signal_source"] = "hook"
	// Positively brand every CLI span as a distinct OpenTelemetry
	// distribution. This is the structural barrier that keeps the
	// agent-hub's SDK discovery (`materialize.ts:discoverAgents`)
	// from EVER picking up a coding-agent span as if it were a
	// regular openlit-go SDK service. Without this, the SDK pipeline
	// only excludes spans that carry `coding_agent.session.id` — a
	// reactive check that fails open the moment a single span
	// somewhere drops the attribute (a race during session warm-up,
	// a future regression, a vendor's native exporter that doesn't
	// know our conventions). The distro marker is set once at SDK
	// init, attaches to every span the process emits, and is the
	// same hook every other OpenTelemetry distribution (ebpf, otel
	// auto-instrumentation, …) uses to identify itself.
	extra["telemetry.distro.name"] = "openlit-cli"
	extra["telemetry.distro.version"] = version.Version

	if err := openlit.Init(openlit.Config{
		OtlpEndpoint:    cfg.OTLPEndpoint,
		OtlpHeaders:     cfg.EffectiveHeaders(),
		Environment:     cfg.Environment,
		ApplicationName: cfg.ApplicationName,
		ServiceVersion:  version.Version,
		// We never want sdk/go to capture prompt/completion bodies on
		// our behalf. Coding-agent content capture is governed by the
		// per-adapter handlers obeying cfg.CodingContentCapture.
		DisableCaptureMessageContent: true,
		// The hook subcommand is short-lived; batch span processor is
		// fine — sdk/go calls Shutdown which forces a flush.
		DisableBatch: false,
		// Pricing fetch is irrelevant for the hook path; disabling it
		// avoids a network call per invocation.
		DisablePricingFetch: true,
		// Metrics ARE enabled — the coding-agent counters
		// (`coding_agent.lines_of_code.count`,
		// `coding_agent.code_edit_tool.decision`,
		// `coding_agent.commit.count`, `coding_agent.pull_request.count`)
		// always emit, regardless of content-capture mode, so backends
		// that consume metrics (Prometheus / Mimir / Grafana cloud)
		// see the same numbers traces backends see. Cost of the
		// metrics pipeline is negligible on the short-lived hook
		// process; the openlit-go SDK already wires up a delta
		// exporter on the same OTLP endpoint as traces.
		DisableMetrics: false,
		// All coding-agent spans for a given session share a
		// deterministic TraceID (and the session-root span gets a
		// deterministic SpanID) so PR #1200's TraceDetailView resolves
		// the full session timeline as a single trace. See tracecontext.go.
		IDGenerator:             sessionIDGenerator{},
		Sampler:                 defaultSampler(),
		ExtraResourceAttributes: extra,
	}); err != nil {
		return nil, fmt.Errorf("openlit.Init: %w", err)
	}

	return &Emitter{
		tracer:    otel.GetTracerProvider().Tracer("openlit-cli"),
		cfg:       cfg,
		vendor:    vendor,
		scrub:     redact.ForCapture(cfg.CodingContentCapture),
		startedAt: time.Now(),
	}, nil
}

// Shutdown flushes pending spans within the context's deadline.
func (e *Emitter) Shutdown(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.shut {
		return nil
	}
	e.shut = true
	return openlit.Shutdown(ctx)
}

// bumpToolCounter / bumpLLMCounter / bumpSubagentCounter persist
// rolled-up totals into the sessionstate cache so the next process
// reading the session (typically sessionEnd, which runs in its own
// short-lived hook invocation) can stamp them on the session-root
// span. Minimal capture mode relies on these to keep dashboards
// useful without per-event spans.
//
// These are best-effort: a cross-process race could undercount by a
// few events. The flock + atomic rename added in D1 keeps the file
// consistent; a tiny race window remains between Load and Save.
func (e *Emitter) bumpToolCounter(sessionID string) {
	if sessionID == "" {
		return
	}
	st := sessionstate.Load(sessionID, e.vendor)
	if st == nil {
		st = &sessionstate.State{}
	}
	st.ToolCallCount++
	sessionstate.Save(sessionID, e.vendor, st)
}

func (e *Emitter) bumpLLMCounter(sessionID string, in, out int64, cost float64) {
	if sessionID == "" {
		return
	}
	st := sessionstate.Load(sessionID, e.vendor)
	if st == nil {
		st = &sessionstate.State{}
	}
	if in > 0 {
		st.InputTokens += in
	}
	if out > 0 {
		st.OutputTokens += out
	}
	if cost > 0 {
		st.CostUSD += cost
	}
	sessionstate.Save(sessionID, e.vendor, st)
}

func (e *Emitter) bumpSubagentCounter(sessionID string) {
	if sessionID == "" {
		return
	}
	st := sessionstate.Load(sessionID, e.vendor)
	if st == nil {
		st = &sessionstate.State{}
	}
	st.SubagentCount++
	sessionstate.Save(sessionID, e.vendor, st)
}

// EmitSession turns a normalize.Session into a single span with
// coding_agent.* + gen_ai.* attributes set.
//
// In minimal mode, before stamping attributes we drain the
// sessionstate counters (tool calls, subagents, tokens, cost) and
// fold them into the session struct so the session-root span carries
// the rolled-up totals dashboards rely on.
//
// F2: we used to emit a session-root span on BOTH sessionStart and
// sessionEnd. With the deterministic IDGenerator both calls produced
// the same TraceID + SpanID — so otel_traces ended up with two rows
// per session, doubling counts and breaking the duration math (the
// first row has startedAt == endedAt, dragging averages to ~0). We
// now skip emission for the "started" lifecycle and rely on the final
// sessionEnd call to write the single authoritative row. Sessions
// that never see a sessionEnd (process killed, network drop) still
// show their child spans on the trace view by their session_id
// resource attribute even without the root span. The trade-off:
// "active" sessions don't appear in the Sessions list until they
// finish, which beats the previous bug of every active session
// counting twice.
//
// The lifecycle marker is the vendor-stamped Extras key
// `<vendor>.session.lifecycle` (set to "started" by every adapter's
// buildSession kind=started path). The previous guard checked
// `s.Outcome == "started"` but adapters never set Outcome that way —
// they only set it on END events ("completed" / "cancelled" / …), so
// the guard was a no-op and the double-emit persisted in production.
func isSessionStart(s normalize.Session) bool {
	if s.Outcome == "started" || s.Outcome == "in_progress" {
		return true
	}
	for _, k := range []string{
		"cursor.session.lifecycle",
		"claude_code.session.lifecycle",
		"codex.session.lifecycle",
	} {
		if v, ok := s.Extras[k]; ok && v == "started" {
			return true
		}
	}
	return false
}

func (e *Emitter) EmitSession(s normalize.Session) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}

	if isSessionStart(s) {
		return nil
	}

	if !perEventSpansAllowed(e.cfg.CodingContentCapture) {
		s = drainCounters(s, e.vendor)
	}
	// LOC / edit / commit / PR rollups are stamped on the session-root
	// span regardless of capture mode — they are scalar telemetry, not
	// user content, and the Sessions list's "Lines / Accept %" columns
	// rely on them being present in every mode.
	s = drainCodeCounters(s, e.vendor)

	startedAt := s.StartedAt
	if startedAt.IsZero() {
		startedAt = e.startedAt
	}
	endedAt := s.EndedAt
	if endedAt.IsZero() {
		endedAt = time.Now()
	}

	// Session-root span. We deliberately attach the session id as a
	// marker in the context (no parent SpanContext) so the
	// `sessionIDGenerator` produces the deterministic root TraceID +
	// SpanID derived from `s.SessionID`. The CLI stamps `vcs.*`
	// resource attributes on this span from local git context (see
	// `cli/internal/coding/git/git.go`); no remote VCS integration is
	// required.
	_, span := e.tracer.Start(
		sessionRootContext(context.Background(), s.SessionID, e.vendor),
		semconv.CodingAgentSpanSession,
		trace.WithTimestamp(startedAt),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(endedAt))

	setSessionAttrs(span, s, e.scrub)
	return nil
}

// EmitToolCall produces a coding-agent tool-call span. In minimal
// capture mode this is a no-op at the span level — counters are
// instead bumped on the session-state cache so they can be rolled
// up onto the session-root span at sessionEnd.
func (e *Emitter) EmitToolCall(t normalize.ToolCall) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	if !perEventSpansAllowed(e.cfg.CodingContentCapture) {
		e.bumpToolCounter(t.SessionID)
		return nil
	}
	startedAt := t.StartedAt
	if startedAt.IsZero() {
		startedAt = time.Now()
	}
	endedAt := t.EndedAt
	if endedAt.IsZero() {
		endedAt = startedAt.Add(t.Duration)
	}

	_, span := e.tracer.Start(
		sessionTraceContext(context.Background(), t.SessionID, e.vendor),
		semconv.CodingAgentSpanToolCall,
		trace.WithTimestamp(startedAt),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(endedAt))

	setToolCallAttrs(span, t, e.scrub, e.cfg.CodingContentCapture)
	return nil
}

// EmitEditDecision produces an edit-decision span. We use a span (not an
// event) so dashboards can drill into individual edits with their own
// timeline rendering. Minimal mode drops the SPAN entirely (cost +
// activity dashboards don't need per-edit drilldowns), but the
// matching metric counters still emit so dashboards keep working.
func (e *Emitter) EmitEditDecision(d normalize.EditDecision) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	// Always emit the metrics — even in minimal mode the dashboards
	// rely on the per-decision counter, and the user-tag carries the
	// session row through the user roll-ups.
	user := resolveLocalUser()
	recordEditDecision(d.Vendor, user, d.Decision, d.Tool, d.Language)
	recordLines(d.Vendor, user, d.Decision, d.LinesAdded, d.LinesRemoved)
	if !perEventSpansAllowed(e.cfg.CodingContentCapture) {
		return nil
	}
	at := d.At
	if at.IsZero() {
		at = time.Now()
	}
	_, span := e.tracer.Start(
		sessionTraceContext(context.Background(), d.SessionID, e.vendor),
		semconv.CodingAgentSpanEditDecision,
		trace.WithTimestamp(at),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(at))

	setEditDecisionAttrs(span, d, e.scrub)
	return nil
}

// EmitLLMTurn produces a coding_agent.llm.turn span representing one
// user-prompt / assistant-response cycle. In minimal mode we instead
// bump in/out/cost counters on the sessionstate cache for the session
// bookend to read.
func (e *Emitter) EmitLLMTurn(t normalize.LLMTurn) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	if !perEventSpansAllowed(e.cfg.CodingContentCapture) {
		e.bumpLLMCounter(t.SessionID, t.InputTokens, t.OutputTokens, t.CostUSD)
		return nil
	}
	startedAt := t.StartedAt
	if startedAt.IsZero() {
		startedAt = time.Now()
	}
	endedAt := t.EndedAt
	if endedAt.IsZero() {
		endedAt = startedAt
	}

	_, span := e.tracer.Start(
		sessionTraceContext(context.Background(), t.SessionID, e.vendor),
		semconv.CodingAgentSpanLLMTurn,
		trace.WithTimestamp(startedAt),
		trace.WithSpanKind(trace.SpanKindClient),
	)
	defer span.End(trace.WithTimestamp(endedAt))

	setLLMTurnAttrs(span, t, e.scrub, e.cfg.CodingContentCapture)
	return nil
}

// EmitSubagent produces a coding_agent.subagent span representing one
// child-agent lifecycle. Minimal mode bumps the subagent counter and
// drops the span — the parent's session bookend will surface the
// count via SubagentCount.
func (e *Emitter) EmitSubagent(s normalize.Subagent) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	if !perEventSpansAllowed(e.cfg.CodingContentCapture) {
		e.bumpSubagentCounter(s.SessionID)
		return nil
	}
	startedAt := s.StartedAt
	if startedAt.IsZero() {
		startedAt = time.Now()
	}
	endedAt := s.EndedAt
	if endedAt.IsZero() {
		if s.DurationMs > 0 {
			endedAt = startedAt.Add(time.Duration(s.DurationMs) * time.Millisecond)
		} else {
			endedAt = startedAt
		}
	}

	_, span := e.tracer.Start(
		sessionTraceContext(context.Background(), s.SessionID, e.vendor),
		semconv.CodingAgentSpanSubagent,
		trace.WithTimestamp(startedAt),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(endedAt))

	setSubagentAttrs(span, s, e.scrub)
	return nil
}

// EmitEvent produces a low-cost child span (kind=internal) representing
// a hook-event-only signal (e.g. coding_agent.shell.requested,
// coding_agent.tool.requested). The span's parent is the deterministic
// session-root SpanID derived from the session id, so it nests
// correctly in TraceDetailView.
//
// We deliberately do NOT use `span.AddEvent(...)` on the session-root
// here: hook events fire in their own short-lived processes, and the
// session-root span is created (and closed) in a separate sessionStart
// process. Re-opening it from a different process by SpanID would
// create a duplicate row in `otel_traces` rather than mutate the
// existing one. A short child span is the cleanest OTel pattern that
// preserves the parent-child relationship the UI needs.
//
// Minimal mode drops the event — counters bumped elsewhere are
// sufficient for budget + activity dashboards, and a per-event span
// would defeat the cost benefit of the mode.
func (e *Emitter) EmitEvent(ev normalize.EventEmission) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	if !perEventSpansAllowed(e.cfg.CodingContentCapture) {
		return nil
	}
	at := ev.At
	if at.IsZero() {
		at = time.Now()
	}
	_, span := e.tracer.Start(
		sessionTraceContext(context.Background(), ev.SessionID, e.vendor),
		ev.Name,
		trace.WithTimestamp(at),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(at))

	if ev.SessionID != "" {
		span.SetAttributes(attribute.String(semconv.CodingAgentSessionID, ev.SessionID))
	}
	for k, v := range ev.Attrs {
		setAnyAttr(span, k, v, e.scrub)
	}
	return nil
}

// EmitGitCommit produces a `coding_agent.git.commit` span representing
// one agent-attributed git commit and bumps the matching metric
// counter. The session-state CommitCount is bumped by the adapter
// before this call so the rollup is durable even if span emission
// fails. Unlike per-tool spans, commit / PR spans are NOT suppressed
// in minimal mode — they are far rarer than tool calls and the
// dashboards rely on having a span row per commit for trace drilldown.
func (e *Emitter) EmitGitCommit(c normalize.GitCommit) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	at := c.At
	if at.IsZero() {
		at = time.Now()
	}
	_, span := e.tracer.Start(
		sessionTraceContext(context.Background(), c.SessionID, e.vendor),
		semconv.CodingAgentSpanGitCommit,
		trace.WithTimestamp(at),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(at))
	setGitCommitAttrs(span, c, e.scrub, e.cfg.CodingContentCapture)
	recordCommit(c.Vendor, c.UserID)
	return nil
}

// EmitGitPullRequest produces a `coding_agent.git.pull_request` span
// representing one agent-attributed PR / MR create and bumps the
// matching metric counter. See EmitGitCommit for the minimal-mode
// rationale.
func (e *Emitter) EmitGitPullRequest(p normalize.GitPullRequest) error {
	if e == nil || e.tracer == nil {
		return errors.New("nil emitter")
	}
	at := p.At
	if at.IsZero() {
		at = time.Now()
	}
	_, span := e.tracer.Start(
		sessionTraceContext(context.Background(), p.SessionID, e.vendor),
		semconv.CodingAgentSpanGitPullRequest,
		trace.WithTimestamp(at),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer span.End(trace.WithTimestamp(at))
	setGitPullRequestAttrs(span, p, e.scrub, e.cfg.CodingContentCapture)
	recordPullRequest(p.Vendor, p.UserID)
	return nil
}
