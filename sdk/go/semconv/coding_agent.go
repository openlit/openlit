// Coding Agent semantic conventions.
//
// These attributes extend OTel GenAI conventions for first-class observability
// of AI coding assistants (Claude Code, Cursor, Codex, etc.).
// They are namespaced under `coding_agent.*` so they coexist cleanly with
// OTel's standard `gen_ai.*`, `vcs.*`, and `server.*` semconvs.
//
// Reuse OTel's existing attributes wherever sensible:
//   - gen_ai.conversation.id  → session linkage
//   - gen_ai.agent.name       → vendor identifier (e.g. "claude-code")
//   - gen_ai.tool.name        → invoked tool
//   - gen_ai.usage.*          → token/cost rollups
//   - vcs.repository.url.full → repo URL  (OTel vcs semconv)
//   - vcs.ref.head.revision   → commit SHA (OTel vcs semconv)
//   - vcs.ref.head.name       → branch    (OTel vcs semconv)
//
// Anything OTel doesn't define lives here.

package semconv

// Vendor identifiers (used as `gen_ai.agent.name` value).
const (
	CodingAgentVendorClaudeCode = "claude-code"
	CodingAgentVendorCursor     = "cursor"
	CodingAgentVendorCodex      = "codex"
	CodingAgentVendorWindsurf   = "windsurf"
)

// Session structure attributes.
const (
	// CodingAgentSessionID identifies a single coding-agent session.
	// Used as the join key across all spans/events emitted for that session.
	CodingAgentSessionID = "coding_agent.session.id"
	// CodingAgentClient is the vendor identifier; mirror of gen_ai.agent.name.
	// Carried separately so dashboard widgets can filter without
	// pulling in the full gen_ai.* attribute set.
	CodingAgentClient = "coding_agent.client"
	// CodingAgentClientVersion is the vendor's client version.
	CodingAgentClientVersion = "coding_agent.client.version"
	// CodingAgentSessionOutcome captures how the session ended.
	// One of: merged | committed | abandoned_no_change | abandoned_with_change | cancelled.
	CodingAgentSessionOutcome = "coding_agent.session.outcome"
	// CodingAgentSessionDurationMs is wall-clock duration in milliseconds.
	CodingAgentSessionDurationMs = "coding_agent.session.duration_ms"
	// CodingAgentSessionToolCallCount totals tool invocations during the session.
	CodingAgentSessionToolCallCount = "coding_agent.session.tool_call_count"
	// CodingAgentSessionSubagentCount totals child/subagent spawns.
	CodingAgentSessionSubagentCount = "coding_agent.session.subagent_count"
	// CodingAgentSessionCostUSD is the realized USD cost.
	CodingAgentSessionCostUSD = "coding_agent.session.cost_usd"

	// Per-session code-change rollups stamped on the
	// `coding_agent.session` root span at SessionEnd. They aggregate
	// edit / accept / reject / line counts the adapter observed
	// across the session so dashboards don't have to fan out into
	// every `coding_agent.edit.decision` span.
	//
	// Mirrors Claude Code's native `claude_code.lines_of_code.count`
	// metric shape — when the operator ships both paths (hook + native
	// OTel exporter), the query layer coalesces.
	CodingAgentSessionLinesAdded      = "coding_agent.session.lines.added"
	CodingAgentSessionLinesRemoved    = "coding_agent.session.lines.removed"
	CodingAgentSessionLinesAccepted   = "coding_agent.session.lines.accepted"
	CodingAgentSessionLinesRejected   = "coding_agent.session.lines.rejected"
	CodingAgentSessionEditAcceptCount = "coding_agent.session.edit.accept_count"
	CodingAgentSessionEditRejectCount = "coding_agent.session.edit.reject_count"
	CodingAgentSessionCommitCount     = "coding_agent.session.commit_count"
	CodingAgentSessionPRCount         = "coding_agent.session.pr_count"
)

// Session outcome values.
const (
	// CodingAgentSessionOutcomeCompleted — the agent reported a
	// successful end of the session (Cursor's reason="completed",
	// Claude Code's "stop", etc). The user may or may not have
	// merged anything; we stay agnostic on downstream VCS state.
	CodingAgentSessionOutcomeCompleted           = "completed"
	CodingAgentSessionOutcomeMerged              = "merged"
	CodingAgentSessionOutcomeCommitted           = "committed"
	CodingAgentSessionOutcomeAbandonedNoChange   = "abandoned_no_change"
	CodingAgentSessionOutcomeAbandonedWithChange = "abandoned_with_change"
	CodingAgentSessionOutcomeCancelled           = "cancelled"
)

// Subagent linkage attributes.
const (
	// CodingAgentAgentID is a stable id for this agent instance within the
	// session (root or subagent). Use parent_id to walk the tree.
	CodingAgentAgentID = "coding_agent.agent.id"
	// CodingAgentAgentParentID points at the spawning agent's id.
	CodingAgentAgentParentID = "coding_agent.agent.parent_id"
	// CodingAgentAgentType is one of: main | subagent | task_tool.
	CodingAgentAgentType = "coding_agent.agent.type"
	// CodingAgentSubagentType is the vendor-specific subagent kind
	// (e.g. Claude Code's named subagents, Codex spawn types).
	CodingAgentSubagentType = "coding_agent.subagent.type"
	// CodingAgentLinkageConfidence reports how reliable the parent_id
	// linkage is for this vendor: high | medium | low.
	// Codex subagent linkage is often medium because parent is
	// inferred via process metadata rather than carried by the protocol.
	CodingAgentLinkageConfidence = "coding_agent.linkage_confidence"
)

const (
	CodingAgentAgentTypeMain     = "main"
	CodingAgentAgentTypeSubagent = "subagent"
	CodingAgentAgentTypeTaskTool = "task_tool"

	CodingAgentLinkageConfidenceHigh   = "high"
	CodingAgentLinkageConfidenceMedium = "medium"
	CodingAgentLinkageConfidenceLow    = "low"
)

// Edit decision attributes — captured per file/edit so dashboards can
// distinguish auto-applied agent edits from user-reviewed ones.
// OTel has no standard for this; this is the major gap we fill.
const (
	// CodingAgentEditDecision is one of: accept | reject | modify | auto_accepted.
	CodingAgentEditDecision = "coding_agent.edit.decision"
	// CodingAgentEditDecisionSource is the trigger:
	// user_interactive | user_permanent_rule | hook | config | policy.
	CodingAgentEditDecisionSource = "coding_agent.edit.decision.source"
	// CodingAgentEditLinesAdded is the count of added lines.
	CodingAgentEditLinesAdded = "coding_agent.edit.lines.added"
	// CodingAgentEditLinesRemoved is the count of removed lines.
	CodingAgentEditLinesRemoved = "coding_agent.edit.lines.removed"
	// CodingAgentEditLanguage is the detected programming language.
	CodingAgentEditLanguage = "coding_agent.edit.language"
	// CodingAgentEditToolName is the tool that produced the edit
	// (e.g. "Edit", "Write", "Apply Patch").
	CodingAgentEditToolName = "coding_agent.edit.tool.name"
)

const (
	CodingAgentEditDecisionAccept       = "accept"
	CodingAgentEditDecisionReject       = "reject"
	CodingAgentEditDecisionModify       = "modify"
	CodingAgentEditDecisionAutoAccepted = "auto_accepted"

	CodingAgentEditDecisionSourceUserInteractive    = "user_interactive"
	CodingAgentEditDecisionSourceUserPermanentRule  = "user_permanent_rule"
	CodingAgentEditDecisionSourceHook               = "hook"
	CodingAgentEditDecisionSourceConfig             = "config"
	CodingAgentEditDecisionSourcePolicy             = "policy"
)

// Tool causality attributes — link tool invocations back to the model
// turn that triggered them. OTel typed span links (PR #3575) will replace
// these once they ship; until then, this is the explicit join key.
const (
	// CodingAgentToolTriggeringLLMRequestID is the LLM response id
	// whose tool_calls produced this invocation.
	CodingAgentToolTriggeringLLMRequestID = "coding_agent.tool.triggering_llm_request_id"
	// CodingAgentToolIteration is the loop index for retried/iterated tools.
	CodingAgentToolIteration = "coding_agent.tool.iteration"
	// CodingAgentToolGroupID groups tools fired in the same model turn.
	CodingAgentToolGroupID = "coding_agent.tool.group.id"
	// CodingAgentToolGroupType describes the group's intent
	// (e.g. "file_edit", "search", "bash").
	CodingAgentToolGroupType = "coding_agent.tool.group.type"
)

// MCP server attribution.
const (
	// CodingAgentMCPServerName is the MCP server identifier.
	CodingAgentMCPServerName = "coding_agent.mcp.server.name"
	// CodingAgentMCPScope is one of: user | project | local | enterprise.
	CodingAgentMCPScope = "coding_agent.mcp.scope"
	// CodingAgentMCPTransport is one of: stdio | sse | streamable_http.
	CodingAgentMCPTransport = "coding_agent.mcp.transport"
	// CodingAgentMCPSource is one of: builtin | plugin | marketplace.
	CodingAgentMCPSource = "coding_agent.mcp.source"
)

const (
	CodingAgentMCPScopeUser       = "user"
	CodingAgentMCPScopeProject    = "project"
	CodingAgentMCPScopeLocal      = "local"
	CodingAgentMCPScopeEnterprise = "enterprise"

	CodingAgentMCPTransportStdio          = "stdio"
	CodingAgentMCPTransportSSE            = "sse"
	CodingAgentMCPTransportStreamableHTTP = "streamable_http"

	CodingAgentMCPSourceBuiltin     = "builtin"
	CodingAgentMCPSourcePlugin      = "plugin"
	CodingAgentMCPSourceMarketplace = "marketplace"
)

// VCS bridging — repo / branch / commit live under OTel's standard
// `vcs.*` attributes (see Reuse note at top of file), stamped on the
// session root from local git context by `cli/internal/coding/git`.
// The constants below cover what OTel doesn't define.
const (
	// CodingAgentVCSDirty indicates the working tree has uncommitted changes
	// when the agent started. Boolean serialized as "true"/"false".
	CodingAgentVCSDirty = "coding_agent.vcs.dirty"
)

// Identity & policy attributes.
const (
	// CodingAgentUserClassification is one of: personal | work | disputed | unknown.
	// Stamped at hook-time using API-key allowlist + repo-origin allowlist.
	CodingAgentUserClassification = "coding_agent.user.classification"
	// CodingAgentUserClassificationReason explains the classification
	// (e.g. "api_key_allowlist", "repo_origin_match", "no_signal").
	CodingAgentUserClassificationReason = "coding_agent.user.classification.reason"
	// CodingAgentPolicyPermissionMode captures how permissive the run is
	// (e.g. "interactive", "auto_accept", "dangerously_skip_permissions").
	CodingAgentPolicyPermissionMode = "coding_agent.policy.permission_mode"
	// CodingAgentContentCaptureMode is the active capture posture:
	// minimal | metadata_only | full. See `cli/internal/otlp/attrs.go`
	// for the per-mode attribute matrix.
	CodingAgentContentCaptureMode = "coding_agent.content_capture_mode"
)

const (
	CodingAgentUserClassificationPersonal = "personal"
	CodingAgentUserClassificationWork     = "work"
	CodingAgentUserClassificationDisputed = "disputed"
	CodingAgentUserClassificationUnknown  = "unknown"

	// CodingAgentContentCaptureMinimal — only session bookends and
	// rolled-up counters. No per-event spans. Cheapest tier; for
	// enterprises that want budget visibility without per-prompt
	// content. See Phase C of the coding-agents plan.
	CodingAgentContentCaptureMinimal = "minimal"
	// CodingAgentContentCaptureMetadataOnly — per-event spans with
	// counts/timings/cost/repo but redacted bodies (no prompts, no
	// tool args, no shell flags). Recommended default.
	CodingAgentContentCaptureMetadataOnly = "metadata_only"
	// CodingAgentContentCaptureFull — everything metadata mode has
	// plus prompts, responses, thoughts, tool args, tool results.
	// Tier-2 PII redaction still runs. For trust+safety reviews.
	CodingAgentContentCaptureFull = "full"
)

// Loop detection.
const (
	// CodingAgentLoopDetected is true when an in-session loop is detected.
	CodingAgentLoopDetected = "coding_agent.loop.detected"
	// CodingAgentLoopPattern names the pattern (e.g. "edit_revert_edit",
	// "tool_retry").
	CodingAgentLoopPattern = "coding_agent.loop.pattern"
)

// Hook plumbing — these are reserved attributes the CLI stamps on every
// hook invocation so we can debug and version the wire format.
const (
	// CodingAgentHookEvent names the originating hook event (e.g. "PreToolUse").
	CodingAgentHookEvent = "coding_agent.hook.event"
	// CodingAgentHookCLIVersion identifies the openlit CLI version.
	CodingAgentHookCLIVersion = "coding_agent.hook.cli.version"
	// CodingAgentHookSchemaVersion is the wire-format schema version.
	// Bump when a breaking change is necessary; receivers read this to
	// stay forward-compatible with the latest CLIs.
	CodingAgentHookSchemaVersion = "coding_agent.hook.schema.version"
)

// Span names emitted by the CLI normalizer. Keep these as constants so
// dashboard SQL can match against a small, stable set.
const (
	CodingAgentSpanSession        = "coding_agent.session"
	CodingAgentSpanToolCall       = "coding_agent.tool.call"
	CodingAgentSpanEditDecision   = "coding_agent.edit.decision"
	CodingAgentSpanSubagent       = "coding_agent.subagent"
	CodingAgentSpanLLMTurn        = "coding_agent.llm.turn"
	// CodingAgentSpanGitCommit is emitted when the agent's Bash /
	// shell tool ran a `git commit` invocation. One span per detected
	// commit, child of the session-root trace.
	CodingAgentSpanGitCommit = "coding_agent.git.commit"
	// CodingAgentSpanGitPullRequest is emitted when the agent's
	// Bash / shell tool created a pull / merge request (`gh pr
	// create`, `git push -u origin <branch>` that produced a PR URL,
	// etc.).
	CodingAgentSpanGitPullRequest = "coding_agent.git.pull_request"
)

// Git commit / pull-request attributes — attached to the matching
// `coding_agent.git.commit` / `coding_agent.git.pull_request` span.
// The body-bearing values (commit message, PR title) are stamped only
// under `full` content capture; the SHA / URL / number are always
// safe to stamp.
const (
	CodingAgentGitCommitSHA     = "coding_agent.git.commit.sha"
	CodingAgentGitCommitMessage = "coding_agent.git.commit.message"
	CodingAgentGitPRURL         = "coding_agent.git.pull_request.url"
	CodingAgentGitPRNumber      = "coding_agent.git.pull_request.number"
	CodingAgentGitPRTitle       = "coding_agent.git.pull_request.title"
)

// Event names — emitted as span events for high-cardinality moments
// where a separate span would be overkill.
const (
	CodingAgentEventSessionStart    = "coding_agent.session.start"
	CodingAgentEventSessionEnd      = "coding_agent.session.end"
	CodingAgentEventEditDecision    = "coding_agent.edit.decision"
	CodingAgentEventLoopDetected    = "coding_agent.loop.detected"
	CodingAgentEventSubagentSpawned = "coding_agent.subagent.spawned"
	CodingAgentEventSubagentDone    = "coding_agent.subagent.completed"
	CodingAgentEventMCPInvoked      = "coding_agent.mcp.tool.invoked"
)

// Metric names — additions on top of gen_ai.* metrics.
//
// The `coding_agent.lines_of_code.count`, `coding_agent.code_edit_tool.decision`,
// `coding_agent.commit.count`, and `coding_agent.pull_request.count`
// counters mirror Claude Code's native exporter shape
// (`claude_code.lines_of_code.count` …) under our canonical namespace.
// They are emitted alongside the matching span so backends that consume
// metrics (Prometheus / Mimir) see the same numbers traces backends do.
const (
	CodingAgentMetricSessionDuration  = "coding_agent.session.duration"
	CodingAgentMetricSessionCostUSD   = "coding_agent.session.cost_usd"
	CodingAgentMetricSessionToolCalls = "coding_agent.session.tool_call_count"
	CodingAgentMetricSessionSubagents = "coding_agent.session.subagent_count"
	CodingAgentMetricToolDuration     = "coding_agent.tool.duration"
	CodingAgentMetricEditDecisions    = "coding_agent.edit.decision.count"
	// CodingAgentMetricLinesOfCode is a counter of added / removed
	// lines tagged with `type=added|removed`, `decision`, `vendor`, `user`.
	CodingAgentMetricLinesOfCode = "coding_agent.lines_of_code.count"
	// CodingAgentMetricEditDecisionCnt is a counter of edit
	// decisions tagged with `decision`, `vendor`, `tool_name`,
	// `language`, `user`. Renamed under our namespace from
	// `claude_code.code_edit_tool.decision`.
	CodingAgentMetricEditDecisionCnt = "coding_agent.code_edit_tool.decision"
	// CodingAgentMetricCommit is a counter of agent-attributed
	// git commits tagged with `vendor`, `user`.
	CodingAgentMetricCommit = "coding_agent.commit.count"
	// CodingAgentMetricPullRequest is a counter of agent-attributed
	// pull / merge requests tagged with `vendor`, `user`.
	CodingAgentMetricPullRequest = "coding_agent.pull_request.count"
)

// Schema version of the coding_agent.* wire format. Bump on breaking changes.
const CodingAgentSchemaVersion = "1"
