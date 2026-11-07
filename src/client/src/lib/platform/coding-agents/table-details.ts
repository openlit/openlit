/**
 * Coding-agent ClickHouse table/column references.
 *
 * Coding-agent telemetry rides the existing `otel_traces` pipeline. We
 * keep dedicated constants here (rather than scatter literal strings
 * across queries) so renames or schema bumps stay localized.
 */

export const OTEL_TRACES_TABLE = "otel_traces";
export const OTEL_LOGS_TABLE = "otel_logs";

/**
 * Span names emitted by the openlit CLI normalizer (mirrors
 * sdk/go/semconv/coding_agent.go::CodingAgentSpan*). Dashboards and
 * APIs filter on these so they never accidentally pull in non-coding
 * gen_ai traffic.
 */
export const CODING_AGENT_SPAN_SESSION = "coding_agent.session";
export const CODING_AGENT_SPAN_TOOL_CALL = "coding_agent.tool.call";
export const CODING_AGENT_SPAN_EDIT_DECISION = "coding_agent.edit.decision";
export const CODING_AGENT_SPAN_SUBAGENT = "coding_agent.subagent";
export const CODING_AGENT_SPAN_LLM_TURN = "coding_agent.llm.turn";
export const CODING_AGENT_SPAN_GIT_COMMIT = "coding_agent.git.commit";
export const CODING_AGENT_SPAN_GIT_PR = "coding_agent.git.pull_request";
export const CODING_AGENT_SPAN_SESSION_SNAPSHOT_START =
	"coding_agent.session.snapshot.start";
export const CODING_AGENT_SPAN_SESSION_SNAPSHOT =
	"coding_agent.session.snapshot";

/**
 * Spans Claude Code exports itself when `CLAUDE_CODE_ENABLE_TELEMETRY=1`, with
 * no OpenLIT hook involved (for example `openlit coding exec` in CI). They carry
 * the session in `session.id` and their own token keys, not `coding_agent.*`.
 */
export const CLAUDE_CODE_VENDOR = "claude-code";
export const CLAUDE_CODE_SPAN_INTERACTION = "claude_code.interaction";
export const CLAUDE_CODE_SPAN_LLM_REQUEST = "claude_code.llm_request";
export const CLAUDE_CODE_SPAN_TOOL = "claude_code.tool";
export const CLAUDE_CODE_NATIVE_SPAN_NAMES = [
	CLAUDE_CODE_SPAN_INTERACTION,
	CLAUDE_CODE_SPAN_LLM_REQUEST,
	CLAUDE_CODE_SPAN_TOOL,
	"claude_code.tool.execution",
	"claude_code.tool.blocked_on_user",
] as const;

/** Keys on native Claude Code spans and events. */
export const CLAUDE_CODE_NATIVE_ATTR = {
	sessionId: "session.id",
	inputTokens: "input_tokens",
	outputTokens: "output_tokens",
	eventName: "event.name",
	apiRequestEvent: "api_request",
	costUsd: "cost_usd",
} as const;

/** All coding-agent span names in a single tuple — handy for `IN (...)` clauses. */
export const CODING_AGENT_SPAN_NAMES = [
	CODING_AGENT_SPAN_SESSION,
	CODING_AGENT_SPAN_TOOL_CALL,
	CODING_AGENT_SPAN_EDIT_DECISION,
	CODING_AGENT_SPAN_SUBAGENT,
	CODING_AGENT_SPAN_LLM_TURN,
	CODING_AGENT_SPAN_GIT_COMMIT,
	CODING_AGENT_SPAN_GIT_PR,
	CODING_AGENT_SPAN_SESSION_SNAPSHOT_START,
	CODING_AGENT_SPAN_SESSION_SNAPSHOT,
] as const;

/**
 * Frequently-read attribute keys. These align 1:1 with constants in
 * `sdk/go/semconv/coding_agent.go` so the wire-format is the only
 * source of truth. Update in lockstep when bumping the schema.
 */
export const CODING_AGENT_ATTR = {
	sessionId: "coding_agent.session.id",
	client: "coding_agent.client",
	clientVersion: "coding_agent.client.version",
	sessionOutcome: "coding_agent.session.outcome",
	sessionDurationMs: "coding_agent.session.duration_ms",
	sessionToolCallCount: "coding_agent.session.tool_call_count",
	sessionSubagentCount: "coding_agent.session.subagent_count",
	sessionCostUsd: "coding_agent.session.cost_usd",
	userClassification: "coding_agent.user.classification",
	userClassificationReason: "coding_agent.user.classification.reason",
	policyPermissionMode: "coding_agent.policy.permission_mode",
	contentCaptureMode: "coding_agent.content_capture_mode",
	editDecision: "coding_agent.edit.decision",
	editDecisionSource: "coding_agent.edit.decision.source",
	editLinesAdded: "coding_agent.edit.lines.added",
	editLinesRemoved: "coding_agent.edit.lines.removed",
	editLanguage: "coding_agent.edit.language",
	editToolName: "coding_agent.edit.tool.name",
	// Per-session code-change rollups. Stamped on the
	// `coding_agent.session` root span at SessionEnd by the otlp
	// emitter — these are the dashboard's primary source of truth
	// for "what did this session change". The query layer falls
	// back to summing the per-edit-decision spans when the session
	// is still in progress (Codex; in-flight Cursor / CC sessions
	// that haven't fired SessionEnd yet).
	sessionLinesAdded: "coding_agent.session.lines.added",
	sessionLinesRemoved: "coding_agent.session.lines.removed",
	sessionLinesAccepted: "coding_agent.session.lines.accepted",
	sessionLinesRejected: "coding_agent.session.lines.rejected",
	sessionEditAcceptCount: "coding_agent.session.edit.accept_count",
	sessionEditRejectCount: "coding_agent.session.edit.reject_count",
	sessionCommitCount: "coding_agent.session.commit_count",
	sessionPrCount: "coding_agent.session.pr_count",
	// Git commit / pull-request span attributes.
	gitCommitSha: "coding_agent.git.commit.sha",
	gitCommitMessage: "coding_agent.git.commit.message",
	gitPrUrl: "coding_agent.git.pull_request.url",
	gitPrNumber: "coding_agent.git.pull_request.number",
	gitPrTitle: "coding_agent.git.pull_request.title",
	mcpServerName: "coding_agent.mcp.server.name",
	mcpScope: "coding_agent.mcp.scope",
	mcpSource: "coding_agent.mcp.source",
	mcpTransport: "coding_agent.mcp.transport",
	vcsDirty: "coding_agent.vcs.dirty",
	hookEvent: "coding_agent.hook.event",
	// Subagent linkage. CLI stamps `coding_agent.agent.parent_id` as a
	// resource attribute on every hook process that knows it's running
	// inside a subagent (Cursor exposes `parent_conversation_id` on
	// subagent payloads). The UI uses it as the chat-thread rollup key
	// so subagents fold under their parent row instead of polluting
	// the Sessions list.
	agentId: "coding_agent.agent.id",
	agentParentId: "coding_agent.agent.parent_id",
	sessionIsSubagent: "coding_agent.session.is_subagent",
} as const;

/** OTel `gen_ai.*` keys we read on coding-agent spans. */
export const GEN_AI_ATTR = {
	agentName: "gen_ai.agent.name",
	userName: "gen_ai.user.name",
	requestModel: "gen_ai.request.model",
	usageCost: "gen_ai.usage.cost",
	usageInputTokens: "gen_ai.usage.input_tokens",
	usageOutputTokens: "gen_ai.usage.output_tokens",
	usageTotalTokens: "gen_ai.usage.total_tokens",
	conversationId: "gen_ai.conversation.id",
	toolName: "gen_ai.tool.name",
	toolCallId: "gen_ai.tool.call.id",
} as const;

/** OTel `vcs.*` keys we read on coding-agent spans. */
export const VCS_ATTR = {
	repoUrl: "vcs.repository.url.full",
	headRevision: "vcs.ref.head.revision",
	headRef: "vcs.ref.head.name",
} as const;

/**
 * Cohort floor used by aggregate-only views (top users, classification
 * boards). Below this threshold, we suppress per-user breakdowns to
 * protect individual contributors' privacy on small teams.
 *
 * Tunable per-org once we ship policy controls; v1 ships a single
 * conservative default.
 */
export const COHORT_K_FLOOR = 5;
