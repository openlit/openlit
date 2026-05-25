// Package normalize defines the contract every per-vendor hook adapter
// implements, plus the canonical Span/Event types they emit.
//
// The split is deliberate: per-vendor adapters under hook/<vendor>/ deal
// with the vendor's quirks (Claude Code stdin JSON, Cursor 8-event-list,
// Codex rollout JSONL); the normalize.* types here are what every adapter
// produces, and what the OTLP emitter consumes. One canonical schema = one
// dashboard regardless of the vendor it came from.
package normalize

import (
	"context"
	"time"
)

// Adapter is the interface a per-vendor hook implementation satisfies.
type Adapter interface {
	// Vendor returns the vendor identifier as it appears in
	// gen_ai.agent.name / coding_agent.client (e.g. "claude-code").
	Vendor() string

	// Handle processes one hook invocation. It is invoked synchronously
	// by the hook subcommand; implementations must respect the context
	// deadline and return promptly. Errors returned from Handle are
	// logged to stderr; the hook subcommand always exits 0.
	Handle(ctx context.Context, in Input) error
}

// Input is the per-invocation payload an adapter receives from the hook
// subcommand. Adapters MAY ignore Event when the vendor does not
// communicate event names through the hook flag.
type Input struct {
	// Vendor is the resolved vendor identifier (matches Adapter.Vendor()).
	Vendor string

	// Event is the vendor-specific event name (e.g. "SessionStart",
	// "PreToolUse", "Stop"). Empty when the vendor omits it.
	Event string

	// Payload is the entire stdin body from the host plugin.
	Payload []byte

	// ContentCapture is one of "metadata_only" | "no_tool_content" |
	// "full". Adapters MUST honor this when constructing event/span
	// attributes that would otherwise contain prompt or tool-arg bodies.
	ContentCapture string

	// Emit is the OTLP-bound emitter the adapter writes to.
	Emit Emitter
}

// Emitter is the surface adapters use to produce OTel spans/events. The
// concrete implementation lives in internal/otlp; we keep this interface
// in normalize/ so adapters don't import the otlp package and we can
// swap exporters in tests without churn.
type Emitter interface {
	// EmitSession emits a single coding-agent session span.
	EmitSession(Session) error
	// EmitToolCall emits a coding-agent tool-call span.
	EmitToolCall(ToolCall) error
	// EmitEditDecision emits an edit-decision span (or event, depending
	// on the implementation; the adapter doesn't care).
	EmitEditDecision(EditDecision) error
	// EmitLLMTurn emits a coding-agent LLM-turn span — one per
	// model-generation pair (prompt → response). Captures the prompt
	// and (optional) response text plus token usage when available.
	// This is the "generation" concept from Sigil/OTel GenAI.
	EmitLLMTurn(LLMTurn) error
	// EmitSubagent emits a coding-agent subagent span representing one
	// child agent's lifecycle. Carries the subagent type, parent linkage,
	// status, and modified-files set so the parent session's tree view
	// can drill into the child.
	EmitSubagent(Subagent) error
	// EmitEvent emits a free-form span event under the provided session
	// or tool span name. Used for high-cardinality moments where a
	// dedicated span would be overkill (e.g. loop detected).
	EmitEvent(EventEmission) error
}

// Session is the canonical "this agent ran" span. Adapters populate as
// many fields as the vendor's payload supports; missing fields are
// allowed and dashboard widgets handle nulls.
type Session struct {
	SessionID      string
	ConversationID string

	Vendor        string
	ClientVersion string
	Model         string
	Provider      string

	StartedAt time.Time
	EndedAt   time.Time
	Duration  time.Duration

	Outcome        string // see semconv.CodingAgentSessionOutcome*
	ToolCallCount  int
	SubagentCount  int
	CostUSD        float64
	InputTokens    int64
	OutputTokens   int64
	TotalTokens    int64

	// VCS fields, populated by cli/internal/coding/git/.
	RepoURL    string
	HeadSHA    string
	BranchName string
	VCSDirty   bool

	// Identity / classification.
	UserID                string
	UserClassification    string // "personal" | "work" | "disputed" | "unknown"
	ClassificationReason  string

	// Permission posture.
	PermissionMode string

	// Free-form vendor extras for the future. Adapters use this for
	// vendor-specific signals we don't (yet) want in the canonical
	// schema. Keys MUST already be namespaced (e.g.
	// "claude_code.transcript_path").
	Extras map[string]string
}

// ToolCall is the canonical tool-call span.
type ToolCall struct {
	SessionID  string
	AgentID    string
	ToolName   string
	ToolUseID  string
	GroupID    string
	GroupType  string
	Iteration  int

	StartedAt time.Time
	EndedAt   time.Time
	Duration  time.Duration

	// Errored is true if the tool returned a non-zero / failure.
	Errored      bool
	ErrorMsg     string
	FailureType  string // "error" | "timeout" | "permission_denied" (Cursor)
	IsInterrupt  bool

	// MCP attribution (if this tool came from an MCP server).
	MCPServerName string
	MCPScope      string
	MCPTransport  string
	MCPSource     string

	// Triggering LLM request.
	TriggeringLLMRequestID string
	Model                  string

	// Sandboxed is true when the tool ran in a sandboxed environment
	// (Cursor's `sandbox` flag for shell execution).
	Sandboxed bool

	WorkingDir string
	Command    string

	Vendor string
	// Argument body — only populated when ContentCapture == "full".
	Args string
	// Result body — only populated when ContentCapture == "full".
	Result string
}

// EditDecision captures one user/agent edit outcome. Vendors that emit a
// PostEdit hook (Claude Code, Codex, Copilot) call EmitEditDecision once
// per modified file.
type EditDecision struct {
	SessionID    string
	AgentID      string
	Decision     string // accept | reject | modify | auto_accepted
	Source       string // user_interactive | user_permanent_rule | hook | config | policy
	Tool         string
	Language     string
	LinesAdded   int
	LinesRemoved int
	FilePath     string

	Vendor string

	At time.Time
}

// LLMTurn captures one user-prompt / assistant-response cycle (also
// known as a "generation"). Vendors map their hooks onto this:
//
//   - Cursor:       beforeSubmitPrompt → StartedAt + Prompt
//                   afterAgentResponse → EndedAt + Response
//                   afterAgentThought  → ThoughtText
//   - Claude Code:  derived from transcript JSONL turns at SessionEnd
//   - Codex:        derived from rollout JSONL on Stop
//
// When an emitter receives an LLMTurn that has only StartedAt/Prompt
// (the "begin" half), it should emit a short-lived span at that time so
// the prompt is preserved even if the matching afterAgentResponse never
// fires (e.g. session aborted mid-generation).
type LLMTurn struct {
	SessionID      string
	ConversationID string
	GenerationID   string
	Vendor         string
	Model          string

	StartedAt time.Time
	EndedAt   time.Time

	// Prompt and Response are captured ONLY when ContentCapture == "full".
	// Both arrive truncated to a sane upper bound at the otlp layer.
	Prompt   string
	Response string
	// ThoughtText is the assistant's reasoning/thinking block, when
	// the vendor exposes it (e.g. Cursor afterAgentThought). Captured
	// separately so dashboards can hide it by default.
	ThoughtText string
	ThoughtMs   int64

	// Attachments lists the prompt attachments the user supplied (file
	// paths, rule files). High-signal, low-cardinality, so always
	// captured regardless of ContentCapture.
	AttachmentPaths []string

	InputTokens  int64
	OutputTokens int64
	TotalTokens  int64
	CostUSD      float64

	// AssistantMessageOnly is true when the LLM turn is only the
	// "after" half (afterAgentResponse) without a paired prompt — the
	// dashboard renders these as continuation turns rather than full
	// generations.
	AssistantMessageOnly bool

	// PermissionMode + UserEmail / UserID from the hook payload.
	UserEmail string
}

// Subagent captures one subagent (Task tool) lifecycle. start and stop
// arrive on different hook invocations; we emit one span per stop with
// the linkage attributes set, plus a low-cost event on start so the
// dashboard can show in-flight subagents.
type Subagent struct {
	SessionID            string
	ParentConversationID string
	SubagentID           string
	SubagentType         string
	Task                 string
	Description          string
	Summary              string
	Vendor               string
	Model                string
	GitBranch            string
	IsParallelWorker     bool

	StartedAt   time.Time
	EndedAt     time.Time
	DurationMs  int64
	MessageCount int
	ToolCallCount int
	LoopCount    int

	// Status is one of: started | completed | error | aborted.
	Status string
	// ModifiedFiles is the file list the subagent touched, when reported.
	ModifiedFiles []string
	// ToolCallID is the parent tool-call that spawned this subagent;
	// useful when joining tool-call spans → subagent spans.
	ToolCallID string
}

// EventEmission is the catch-all for span events the dedicated structs
// above don't cover.
type EventEmission struct {
	SessionID string
	Name      string
	At        time.Time
	Attrs     map[string]any
}
