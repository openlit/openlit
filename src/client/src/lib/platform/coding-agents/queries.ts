/**
 * Read-only ClickHouse helpers for the coding-agents views.
 *
 * Every helper takes a CodingAgentAuth value so the org filter is
 * never optional. We intentionally don't accept a free-form
 * `organizationId` — pass the auth bag, which the API route gets from
 * `requireCodingAgentAuth()`.
 *
 * For v1 we only need the read paths used by:
 *   - /agents detail page (overview + sessions list)
 *   - /api/coding-agents/sessions[/id]
 *
 * Aggregated views (governance board, top-N) live in the seeded
 * dashboard JSON and run through the dashboard widget executor; we
 * don't need to duplicate them here.
 *
 * Privacy guardrails:
 *   - viewer-tier callers cannot read the per-session `gen_ai.user.name`
 *     when the session count for that user is below COHORT_K_FLOOR.
 *     We enforce that in `listSessions`/`getSession` by replacing the
 *     value with the literal string 'low_cohort'.
 */

import { dataCollector } from "@/lib/platform/common";
import {
	CODING_AGENT_AUDIT_LOG_TABLE,
	CODING_AGENT_DISPUTES_TABLE,
} from "@/clickhouse/migrations/create-coding-agents-audit-migration";
import {
	CODING_AGENT_ATTR,
	CODING_AGENT_SPAN_EDIT_DECISION,
	CODING_AGENT_SPAN_GIT_COMMIT,
	CODING_AGENT_SPAN_GIT_PR,
	CODING_AGENT_SPAN_LLM_TURN,
	CODING_AGENT_SPAN_NAMES,
	CODING_AGENT_SPAN_SESSION,
	CODING_AGENT_SPAN_SUBAGENT,
	CODING_AGENT_SPAN_TOOL_CALL,
	COHORT_K_FLOOR,
	GEN_AI_ATTR,
	OTEL_TRACES_TABLE,
	VCS_ATTR,
} from "./table-details";
import type { CodingAgentAuth } from "./auth";
import type {
	CodingAgentClassification,
	CodingAgentClassificationDispute,
} from "./classifier";
import { buildSessionsHaving, escape } from "./query-builders";

export { buildSessionsHaving } from "./query-builders";

// Wire-format sort keys for the Sessions tab. Mapped to ClickHouse
// columns via SESSIONS_SORT_COLUMNS below; `latest` is the default
// and matches the historic ORDER BY started_at DESC behaviour.
export type CodingSessionsSortBy =
	| "latest"
	| "duration"
	| "cost"
	| "tokens"
	| "tool_calls";

const SESSIONS_SORT_COLUMNS: Record<CodingSessionsSortBy, string> = {
	latest: "started_at",
	duration: "duration_ms",
	cost: "cost_usd",
	tokens: "total_tokens",
	tool_calls: "tool_call_count",
};

export interface ListSessionsOptions {
	limit?: number;
	cursor?: string | null;
	vendor?: string | null;
	user?: string | null;
	classification?: CodingAgentClassification | null;
	since?: Date | null;
	until?: Date | null;
	// `offset` is the alternative pagination model used by the new
	// telemetry signal-list (it sends `offset/limit` rather than the
	// cursor convention). When set, `cursor` is ignored.
	offset?: number;
	// When `withTotal` is true the helper runs an extra count(*) query
	// so the caller can render a total badge on the table.
	withTotal?: boolean;
	// Sort surface for the Sessions tab toolbar. Keys map to columns
	// of the `sessions_raw` CTE — see `SESSIONS_SORT_COLUMNS`.
	sortBy?: CodingSessionsSortBy;
	sortDir?: "asc" | "desc";
	// Subagent rows (Cursor background agents, Codex subagents) are
	// folded under the parent chat in the trace-detail view. By
	// default we also hide them from the top-level Sessions list so
	// one chat = one row. Setting this to true brings them back —
	// useful for debugging linkage gaps or when a user explicitly
	// wants to see every emitted session row.
	includeSubagents?: boolean;
}


export interface CodingAgentSessionRow {
	session_id: string;
	vendor: string;
	user: string;
	started_at: string;
	ended_at: string | null;
	duration_ms: number;
	tool_call_count: number;
	cost_usd: number;
	outcome: string;
	classification: CodingAgentClassification;
	classification_reason: string;
	repo_url: string;
	repo_dirty: boolean;
	// Branch name (`vcs.ref.head.name`). Lets the session row show
	// "openlit/openlit @ feature/x" without opening the trace detail.
	branch: string;
	// Top model used in the session (most-recent gen_ai.request.model
	// across the session's spans). Empty when no LLM/tool span carried
	// a model attribute.
	model: string;
	// Aggregate token totals — sumed across LLM-turn spans. Most CLI
	// adapters set both halves; Cursor only emits output tokens for
	// some events so input may be 0 when the upstream payload didn't
	// include it.
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
	// `trace_id` is the OTel TraceId every span in this session shares.
	// The CLI derives it deterministically from (session_id, vendor)
	// so all spans for the same (chat, vendor) pair land in the same
	// trace across separate hook processes.
	trace_id: string;
	// `session_root_span_id` is the SpanId we open in TraceDetailView.
	// The CLI stamps a deterministic SpanId on the `coding_agent.session`
	// root span; this column prefers that span and falls back to the
	// chronologically-first child if no root span was emitted yet.
	session_root_span_id: string;
	// Latest permission mode (Cursor's composer_mode: agent / ask /
	// plan; Claude Code: default / plan / acceptEdits / etc.). The
	// value is the most recent observed across the session, so a
	// row's mode chip reflects what the agent is currently set to.
	permission_mode: string;
	// Working folder (cwd) the agent is operating in. Surfaced as a
	// short trailing path (`/openlit/src`) on the row and as a full
	// pill on the trace-detail header.
	working_dir: string;
	working_dir_label: string;
	// Per-session code-change rollups. The query prefers the
	// session-rollup attribute (stamped on the session-root span at
	// SessionEnd) and falls back to summing the per-edit-decision
	// spans when the session is still in progress / never fired
	// SessionEnd (Codex; long-running CC sessions that closed
	// without /exit). `acceptance_pct` is computed at query time
	// from accepted / (accepted + rejected); 0 when both are zero
	// so the row renders "—" instead of NaN.
	lines_added: number;
	lines_removed: number;
	lines_accepted: number;
	lines_rejected: number;
	edit_accept_count: number;
	edit_reject_count: number;
	acceptance_pct: number;
	commit_count: number;
	pr_count: number;
	// True when the chat is a subagent of another chat — i.e. any span
	// in the rollup has `coding_agent.agent.parent_id` set or the CLI
	// stamped `coding_agent.session.is_subagent`. listSessions hides
	// these by default; they fold under the parent chat via the
	// CHAT_ID_EXPR coalesce.
	is_subagent: 0 | 1;
}

/**
 * Cost is rolled up two ways:
 *  - the session-level `coding_agent.session.cost_usd` attribute (set by
 *    Claude Code from transcript JSONL with realized prices)
 *  - sum of `gen_ai.usage.cost` across all child spans (used by Cursor,
 *    where we estimate cost from token-length heuristics on the
 *    LLM-turn spans because Cursor's hooks don't surface tokens).
 *
 * We take whichever is greater so a vendor's authoritative number wins
 * when present. Tool-call counts work the same way: prefer the session
 * attribute when present, otherwise count `coding_agent.tool.call`
 * spans.
 */
// User identity. The CLI hook subcommand resolves the canonical
// email-shaped identity BEFORE booting the OTel SDK (Cursor's
// `user_email`, Claude Code's `~/.claude.json#oauthAccount.emailAddress`,
// Codex's `~/.codex/auth.json` JWT, or `git config user.email`) and
// stamps it as `gen_ai.user.name` on every emitted span. We also
// accept Claude Code's native `user.email` resource attribute (set
// when `CLAUDE_CODE_ENABLE_TELEMETRY=1`) for users who haven't
// installed the openlit plugin.
//
// We deliberately do NOT fall through to `service.name` here — that
// would surface an agent identifier ("claude-code") in the user
// column when identity resolution misses, which produced confusing
// "claude-code" user rows in the hub.
const USER_EXPR = `
	coalesce(
		nullIf(any(SpanAttributes['${GEN_AI_ATTR.userName}']), ''),
		nullIf(any(ResourceAttributes['${GEN_AI_ATTR.userName}']), ''),
		nullIf(any(ResourceAttributes['user.email']), ''),
		nullIf(any(SpanAttributes['user.email']), ''),
		'unknown'
	)
`;

// Per-span vendor expression: resolves a SINGLE span to its agent
// identity. Used in the GROUP BY so a chat id that legitimately
// hosts spans from two vendors (e.g. Claude Code launched inside a
// Cursor terminal — both hooks fire under the host's chat id) folds
// into TWO rows, one per vendor, instead of one collapsed row whose
// "winning" vendor depends on which side emitted more spans. The
// user-facing contract is "cursor chat in cursor sessions, claude
// code chats in claude code sessions no matter the terminal".
//
// Order:
//   1. SpanAttributes['coding_agent.client'] — the per-span stamp
//      adapters set on every emitted span (canonical).
//   2. ResourceAttributes['gen_ai.agent.name'] — SDK-style stamp.
//   3. ResourceAttributes['service.name'] — Claude Code's native OTel
//      exporter sets this to "claude-code"; recognise it so users
//      who only enable `CLAUDE_CODE_ENABLE_TELEMETRY=1` (no openlit
//      plugin installed) still show up in the hub.
const PER_SPAN_VENDOR_EXPR = `
	coalesce(
		nullIf(SpanAttributes['${CODING_AGENT_ATTR.client}'], ''),
		nullIf(ResourceAttributes['${GEN_AI_ATTR.agentName}'], ''),
		nullIf(ResourceAttributes['service.name'], ''),
		'unknown'
	)
`;
// VENDOR_EXPR resolves the AGGREGATED vendor for a session group
// after the GROUP BY (chat_id, per_span_vendor) split. Inside the
// group every span has the same vendor by construction, so any()
// is enough — we keep the coalesce only as defence-in-depth against
// a single malformed span in the bucket.
const VENDOR_EXPR = `
	coalesce(
		nullIf(any(SpanAttributes['${CODING_AGENT_ATTR.client}']), ''),
		nullIf(any(ResourceAttributes['${GEN_AI_ATTR.agentName}']), ''),
		nullIf(any(ResourceAttributes['service.name']), ''),
		'unknown'
	)
`;

// E1 deferral note: a coding_agent_sessions ReplacingMergeTree
// materialized view would speed up the Sessions list at ~1M+ spans
// per day, but in beta we don't have that volume yet and the GROUP BY
// over `otel_traces` is fast enough (sub-second on the dev set). When
// we ship the MV, change `OTEL_TRACES_TABLE` to point at it and rely
// on the chat-id rollup already in SESSION_BASE_COLUMNS.

// CHAT_ID_EXPR resolves a span to its chat-thread identifier. We try
// the fields in order of stability so one chat-thread = one chat row,
// even when the vendor exposes multiple ids per event:
//   1. If a parent_id resource attribute is set, this span is from a
//      subagent and we fold it under the parent's chat. The CLI stamps
//      `coding_agent.agent.parent_id` as a resource attribute on every
//      hook process that knows it's running inside a subagent (Cursor
//      reports `parent_conversation_id` on subagent payloads).
//   2. `gen_ai.conversation.id` — the chat-thread id, stamped by the
//      CLI from Cursor's `conversation_id`. Stable across plan-mode
//      toggles and Cursor process restarts within one chat. We prefer
//      it over `coding_agent.session.id` because Cursor's session_id
//      can be absent on some events (forcing a fallback to
//      conversation_id mid-chat) which would otherwise split one chat
//      across multiple chat-id values.
//   3. `coding_agent.session.id` — fallback when no conversation id is
//      stamped (Claude Code / Codex, where session_id IS the chat).
//   4. `session.id` — Claude Code's native OTel exporter (when
//      `CLAUDE_CODE_ENABLE_TELEMETRY=1`) puts its identifier here
//      directly. We fall through to it so native-only installs still
//      get a stable chat row.
// Used in tandem with PER_SPAN_VENDOR_EXPR as the (chat_id, vendor)
// rollup key: two vendors firing under the same chat id (Claude Code
// launched inside a Cursor terminal) fold into TWO rows so each
// agent's chat shows up under its own vendor regardless of which
// editor hosted it.
const CHAT_ID_EXPR = `
	coalesce(
		nullIf(ResourceAttributes['${CODING_AGENT_ATTR.agentParentId}'], ''),
		nullIf(SpanAttributes['${CODING_AGENT_ATTR.agentParentId}'], ''),
		nullIf(ResourceAttributes['gen_ai.conversation.id'], ''),
		nullIf(SpanAttributes['gen_ai.conversation.id'], ''),
		nullIf(SpanAttributes['${CODING_AGENT_ATTR.sessionId}'], ''),
		nullIf(ResourceAttributes['${CODING_AGENT_ATTR.sessionId}'], ''),
		nullIf(SpanAttributes['session.id'], ''),
		nullIf(ResourceAttributes['session.id'], '')
	)
`;

const SESSION_BASE_COLUMNS = `
	${CHAT_ID_EXPR}                                                    AS session_id,
	${VENDOR_EXPR}                                                     AS vendor,
	${USER_EXPR}                                                       AS user,
	-- Explicit 'UTC' timezone — the literal 'Z' in the format string
	-- was previously a lie when ClickHouse was running with a non-UTC
	-- local timezone. The 3-arg form forces the output to be UTC,
	-- matching the trailing 'Z' marker.
	formatDateTime(min(Timestamp), '%Y-%m-%dT%H:%i:%SZ', 'UTC')        AS started_at,
	formatDateTime(max(Timestamp), '%Y-%m-%dT%H:%i:%SZ', 'UTC')        AS ended_at,
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionDurationMs}'])),
		toInt64(toUnixTimestamp64Milli(max(Timestamp)) - toUnixTimestamp64Milli(min(Timestamp)))
	) AS duration_ms,
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionToolCallCount}'])),
		toInt64(countIf(SpanName = '${CODING_AGENT_SPAN_TOOL_CALL}'))
	) AS tool_call_count,
	-- Cost rollup. Two source paths exist:
	--   (1) The session-root span stamps coding_agent.session.cost_usd
	--       (CLI-specific rollup) AND gen_ai.usage.cost (per OTel
	--       GenAI conventions on the root) at SessionEnd.
	--   (2) Every llm.turn child span stamps gen_ai.usage.cost per turn.
	-- A naive sum(gen_ai.usage.cost) double-counts ended sessions
	-- because the root span also carries it. We prefer the
	-- authoritative session_cost_usd on the root when present and
	-- only sum **child** spans otherwise.
	coalesce(
		nullIf(toFloat64OrZero(anyIf(
			SpanAttributes['${CODING_AGENT_ATTR.sessionCostUsd}'],
			SpanName = '${CODING_AGENT_SPAN_SESSION}'
		)), 0),
		sumOrNull(if(
			SpanName != '${CODING_AGENT_SPAN_SESSION}',
			toFloat64OrZero(SpanAttributes['${GEN_AI_ATTR.usageCost}']),
			0
		))
	)                                                                  AS cost_usd,
	-- Outcome: pick the LATEST non-empty value, not just any(). Stop
	-- events on Claude Code and Codex stamp "completed" once per turn,
	-- and SessionEnd (when it fires on CC) stamps the terminal verdict
	-- like "abandoned_with_change" / "cancelled". We want the terminal
	-- verdict to win — that only happens if we sort by Timestamp. With
	-- plain any() the row could permanently latch onto an early
	-- "completed" even after the user cancelled.
	coalesce(
		nullIf(
			argMaxIf(
				SpanAttributes['${CODING_AGENT_ATTR.sessionOutcome}'],
				Timestamp,
				notEmpty(SpanAttributes['${CODING_AGENT_ATTR.sessionOutcome}'])
			),
			''
		),
		'unknown'
	) AS outcome,
	coalesce(nullIf(any(SpanAttributes['${CODING_AGENT_ATTR.userClassification}']), ''), 'unknown') AS classification,
	coalesce(nullIf(any(SpanAttributes['${CODING_AGENT_ATTR.userClassificationReason}']), ''), 'no_signal') AS classification_reason,
	-- VCS metadata. We surface the LATEST non-empty value across the
	-- session (argMax by Timestamp), preferring the span attribute —
	-- which carries the live per-turn value (Cursor's git_branch
	-- payload, Claude Code's transcript gitBranch) — over the resource
	-- attribute, which is the per-process session-start snapshot. This
	-- way a mid-session branch / repo switch shows the current value on
	-- the row instead of latching onto whichever span any() happened to
	-- pick. Falls through to the resource attr for spans (llm.turn /
	-- tool.call) that never stamped a span-level VCS attribute.
	coalesce(
		nullIf(argMaxIf(SpanAttributes['${VCS_ATTR.repoUrl}'], Timestamp, notEmpty(SpanAttributes['${VCS_ATTR.repoUrl}'])), ''),
		nullIf(argMaxIf(ResourceAttributes['${VCS_ATTR.repoUrl}'], Timestamp, notEmpty(ResourceAttributes['${VCS_ATTR.repoUrl}'])), '')
	)                                                                  AS repo_url,
	coalesce(
		nullIf(argMaxIf(SpanAttributes['${VCS_ATTR.headRef}'], Timestamp, notEmpty(SpanAttributes['${VCS_ATTR.headRef}'])), ''),
		nullIf(argMaxIf(ResourceAttributes['${VCS_ATTR.headRef}'], Timestamp, notEmpty(ResourceAttributes['${VCS_ATTR.headRef}'])), '')
	)                                                                  AS branch,
	if(any(SpanAttributes['${CODING_AGENT_ATTR.vcsDirty}']) = 'true', 1, 0) AS repo_dirty,
	-- Latest model used by the session (argMax keeps the most recent
	-- non-empty value across all child spans).
	argMaxIf(
		SpanAttributes['${GEN_AI_ATTR.requestModel}'],
		Timestamp,
		notEmpty(SpanAttributes['${GEN_AI_ATTR.requestModel}'])
	)                                                                  AS model,
	-- Token rollups. Same shape as cost above: the session root
	-- stamps gen_ai.usage.*_tokens at SessionEnd (rolled-up across the
	-- whole session, per OTel GenAI conventions), AND every llm.turn
	-- child span stamps its own per-turn count. A naive sum across
	-- all spans double-counts ended sessions. Prefer the authoritative
	-- root value when present and only sum **child** spans otherwise.
	toInt64(coalesce(
		nullIf(toInt64OrZero(anyIf(
			SpanAttributes['${GEN_AI_ATTR.usageInputTokens}'],
			SpanName = '${CODING_AGENT_SPAN_SESSION}'
		)), 0),
		sumOrNull(if(
			SpanName != '${CODING_AGENT_SPAN_SESSION}',
			toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageInputTokens}']),
			0
		))
	))                                                                 AS input_tokens,
	toInt64(coalesce(
		nullIf(toInt64OrZero(anyIf(
			SpanAttributes['${GEN_AI_ATTR.usageOutputTokens}'],
			SpanName = '${CODING_AGENT_SPAN_SESSION}'
		)), 0),
		sumOrNull(if(
			SpanName != '${CODING_AGENT_SPAN_SESSION}',
			toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageOutputTokens}']),
			0
		))
	))                                                                 AS output_tokens,
	toInt64(coalesce(
		nullIf(toInt64OrZero(anyIf(
			SpanAttributes['${GEN_AI_ATTR.usageTotalTokens}'],
			SpanName = '${CODING_AGENT_SPAN_SESSION}'
		)), 0),
		sumOrNull(if(
			SpanName != '${CODING_AGENT_SPAN_SESSION}',
			toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageInputTokens}']) +
				toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageOutputTokens}']),
			0
		))
	))                                                                 AS total_tokens,
	-- TraceId for the session. The CLI derives it deterministically
	-- from (session_id, vendor) so every span in the same (chat,
	-- vendor) group shares one TraceId — any() picks the same value
	-- across the group. We still prefer the session-root span's
	-- TraceId explicitly so reads stay deterministic if a future
	-- regression breaks the deterministic derivation for child spans.
	coalesce(
		nullIf(anyIf(TraceId, SpanName = '${CODING_AGENT_SPAN_SESSION}'), ''),
		argMax(TraceId, Timestamp)
	)                                                                  AS trace_id,
	-- SpanId we open in TraceDetailView. Prefer the explicit
	-- session-root span when present; otherwise fall back to the
	-- chronologically-first child span so the detail page is always
	-- reachable, even when sessionEnd never fired.
	coalesce(
		nullIf(anyIf(SpanId, SpanName = '${CODING_AGENT_SPAN_SESSION}'), ''),
		argMin(SpanId, Timestamp)
	)                                                                  AS session_root_span_id,
	-- Latest permission mode seen in the session (composer_mode for
	-- Cursor, permission_mode for Claude Code). argMaxIf keeps the
	-- most recent non-empty value across all child spans, so a
	-- mid-session toggle is reflected on the row immediately.
	-- Fall through to the resource attribute the CLI stamps for
	-- short-lived hook invocations where the session-root span isn't
	-- in this batch.
	coalesce(
		nullIf(
			argMaxIf(
				SpanAttributes['${CODING_AGENT_ATTR.policyPermissionMode}'],
				Timestamp,
				notEmpty(SpanAttributes['${CODING_AGENT_ATTR.policyPermissionMode}'])
			),
			''
		),
		nullIf(any(ResourceAttributes['${CODING_AGENT_ATTR.policyPermissionMode}']), ''),
		''
	)                                                                  AS permission_mode,
	-- Working folder. The session-root span carries it directly; we
	-- fall through to any tool-call span's code.cwd and finally to
	-- the resource attribute the CLI stamps on every span in the
	-- same process so child spans expose it too. The label is just
	-- the trailing 2 path segments so the row stays compact.
	coalesce(
		nullIf(anyIf(SpanAttributes['code.cwd'], SpanName = '${CODING_AGENT_SPAN_SESSION}'), ''),
		nullIf(anyIf(SpanAttributes['code.cwd'], notEmpty(SpanAttributes['code.cwd'])), ''),
		nullIf(any(ResourceAttributes['code.cwd']), ''),
		''
	)                                                                  AS working_dir,
	arrayStringConcat(
		arraySlice(
			arrayFilter(s -> s != '', splitByChar('/',
				coalesce(
					nullIf(anyIf(SpanAttributes['code.cwd'], SpanName = '${CODING_AGENT_SPAN_SESSION}'), ''),
					nullIf(anyIf(SpanAttributes['code.cwd'], notEmpty(SpanAttributes['code.cwd'])), ''),
					nullIf(any(ResourceAttributes['code.cwd']), ''),
					''
				)
			)),
			-2
		),
		'/'
	)                                                                  AS working_dir_label,
	-- Per-session code-change rollups. Each pair takes the greater
	-- of the session-rollup attribute (stamped on the session-root
	-- span at SessionEnd) and the sum of per-edit-decision span
	-- attrs. The fallback handles two cases:
	--   1. Codex sessions, which have no SessionEnd hook — the
	--      session-root span never gets the rollup, so we sum the
	--      per-edit spans instead.
	--   2. In-flight Claude Code / Cursor sessions that haven't
	--      fired SessionEnd yet (the UI is allowed to show partial
	--      data during a live session).
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesAdded}'])),
		toInt64(sumIf(
			toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
			SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
		))
	)                                                                  AS lines_added,
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesRemoved}'])),
		toInt64(sumIf(
			toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesRemoved}']),
			SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
		))
	)                                                                  AS lines_removed,
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesAccepted}'])),
		toInt64(sumIf(
			toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
			SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
				AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] IN ('accept', 'auto_accepted')
		))
	)                                                                  AS lines_accepted,
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesRejected}'])),
		toInt64(sumIf(
			toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
			SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
				AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] = 'reject'
		))
	)                                                                  AS lines_rejected,
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditAcceptCount}'])),
		toInt64(countIf(
			SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
				AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] IN ('accept', 'auto_accepted')
		))
	)                                                                  AS edit_accept_count,
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditRejectCount}'])),
		toInt64(countIf(
			SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
				AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] = 'reject'
		))
	)                                                                  AS edit_reject_count,
	-- acceptance_pct is computed downstream of the greatest()
	-- pairs above so it stays consistent with the displayed
	-- accept / reject totals (otherwise a SessionEnd that
	-- under-counted vs the per-edit sum would skew the %).
	if(
		(greatest(
			toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditAcceptCount}'])),
			toInt64(countIf(
				SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
					AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] IN ('accept', 'auto_accepted')
			))
		) + greatest(
			toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditRejectCount}'])),
			toInt64(countIf(
				SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
					AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] = 'reject'
			))
		)) = 0,
		toFloat64(0),
		round(
			toFloat64(greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditAcceptCount}'])),
				toInt64(countIf(
					SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
						AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] IN ('accept', 'auto_accepted')
				))
			)) * 100 /
			toFloat64(greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditAcceptCount}'])),
				toInt64(countIf(
					SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
						AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] IN ('accept', 'auto_accepted')
				))
			) + greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditRejectCount}'])),
				toInt64(countIf(
					SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
						AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] = 'reject'
				))
			)),
			2
		)
	)                                                                  AS acceptance_pct,
	-- Commit / PR rollups. Same dual-source pattern: prefer the
	-- session-rollup attribute, fall back to counting the
	-- per-commit / per-PR spans.
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionCommitCount}'])),
		toInt64(countIf(SpanName = '${CODING_AGENT_SPAN_GIT_COMMIT}'))
	)                                                                  AS commit_count,
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionPrCount}'])),
		toInt64(countIf(SpanName = '${CODING_AGENT_SPAN_GIT_PR}'))
	)                                                                  AS pr_count,
	-- Is this chat a subagent of another chat? True when ANY span in
	-- the group has a non-empty parent_id (resource OR span attr) OR
	-- the CLI explicitly stamped coding_agent.session.is_subagent
	-- on the session-root resource. listSessions hides these by
	-- default - they fold under the parent chat via CHAT_ID_EXPR.
	-- The check is intentionally lenient so a partial linkage (e.g.
	-- parent_id only on a few spans, missing on the root) still
	-- classifies the chat as a subagent.
	if(
		max(
			notEmpty(SpanAttributes['${CODING_AGENT_ATTR.agentParentId}']) OR
			notEmpty(ResourceAttributes['${CODING_AGENT_ATTR.agentParentId}']) OR
			ResourceAttributes['coding_agent.session.is_subagent'] = 'true' OR
			SpanAttributes['coding_agent.session.is_subagent'] = 'true'
		),
		1,
		0
	) AS is_subagent
`;

/**
 * The shared filter shared by every read in this module. Notes:
 *   - `ResourceAttributes['organization.id']` is the convention we
 *     plan to set in the materializer migration; for v1 we don't yet
 *     populate it, so the filter degrades into a per-database-config
 *     query (the dataCollector already scopes to the user's
 *     databaseConfigId via session). We still emit the WHERE so we
 *     don't have to migrate every consumer when v2 lights it up.
 *   - Span name in CODING_AGENT_SPAN_NAMES so unrelated traces don't
 *     leak in.
 */
// whereScope is the canonical WHERE block for every coding-agents
// read query. Org isolation today happens at the ClickHouse layer
// (one DB per org, picked by `dataCollector`), so we don't emit an
// `organization.id = ...` filter here unless the CLI has started
// stamping the resource attribute AND the deployment has opted
// into the extra filter via `OPENLIT_REQUIRE_ORG_FILTER=1`.
//
// E5 placeholder: passing `auth` lets callers stamp the extra
// filter the day the CLI ships the resource attribute, without
// another query rewrite. The `requireOrgFilter` gate keeps the
// behaviour identical for existing self-host deployments where the
// CLI hasn't been upgraded yet (those would otherwise return zero
// rows for sessions emitted before the CLI started stamping).
const ORG_ID_RESOURCE_ATTR = "openlit.organization.id";
function whereScope(opts?: {
	since?: Date | null;
	until?: Date | null;
	auth?: CodingAgentAuth | null;
}) {
	const since = opts?.since
		? `AND Timestamp >= parseDateTimeBestEffort('${escape(opts.since.toISOString())}')`
		: "";
	const until = opts?.until
		? `AND Timestamp <= parseDateTimeBestEffort('${escape(opts.until.toISOString())}')`
		: "";

	const requireOrgFilter =
		process.env.OPENLIT_REQUIRE_ORG_FILTER === "1" ||
		process.env.OPENLIT_REQUIRE_ORG_FILTER === "true";
	const orgId = opts?.auth?.organizationId;
	const orgScope =
		requireOrgFilter && orgId
			? `AND coalesce(
					nullIf(ResourceAttributes['${ORG_ID_RESOURCE_ATTR}'], ''),
					nullIf(SpanAttributes['${ORG_ID_RESOURCE_ATTR}'], ''),
					''
				) = '${escape(orgId)}'`
			: "";

	return `
		WHERE SpanName IN (${CODING_AGENT_SPAN_NAMES.map((n) => `'${n}'`).join(", ")})
		AND notEmpty(SpanAttributes['${CODING_AGENT_ATTR.sessionId}'])
		${since}
		${until}
		${orgScope}
	`;
}

/**
 * List recent coding-agent sessions for the active org/database.
 * Cursor is the started_at timestamp of the last row (descending paging).
 * Pass `offset` instead of `cursor` to get classic pagination (the new
 * `<ObservabilitySignalList>` uses offset/limit).
 */
export async function listSessions(
	auth: CodingAgentAuth,
	opts: ListSessionsOptions = {}
): Promise<{
	rows: CodingAgentSessionRow[];
	nextCursor: string | null;
	total: number | null;
}> {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const offset = Math.max(opts.offset ?? 0, 0);
	const useOffset = typeof opts.offset === "number";
	const cursorClause = !useOffset && opts.cursor
		? `WHERE started_at < '${escape(opts.cursor)}'`
		: "";
	const havingClause = buildSessionsHaving(opts);

	// Cursor pagination presumes a stable order on `started_at` —
	// we only honor a custom sort when callers use offset pagination.
	const sortBy: CodingSessionsSortBy = useOffset
		? opts.sortBy || "latest"
		: "latest";
	const sortDir = opts.sortDir === "asc" ? "ASC" : "DESC";
	const orderColumn = SESSIONS_SORT_COLUMNS[sortBy] || "started_at";
	const orderClause = `ORDER BY ${orderColumn} ${sortDir}, started_at DESC`;

	const sessionsRawCte = `
		WITH sessions_raw AS (
			SELECT
				${SESSION_BASE_COLUMNS}
			FROM ${OTEL_TRACES_TABLE}
			${whereScope({
				since: opts.since ?? null,
				until: opts.until ?? null,
				auth,
			})}
			GROUP BY ${CHAT_ID_EXPR}, ${PER_SPAN_VENDOR_EXPR}
			${havingClause}
		)
	`;

	const dataQuery = useOffset
		? `
			${sessionsRawCte}
			SELECT *
			FROM sessions_raw
			${cursorClause}
			${orderClause}
			LIMIT ${limit}
			OFFSET ${offset}
		`
		: `
			${sessionsRawCte}
			SELECT *
			FROM sessions_raw
			${cursorClause}
			ORDER BY started_at DESC
			LIMIT ${limit + 1}
		`;

	const dataPromise = dataCollector({ query: dataQuery });
	const totalPromise = opts.withTotal
		? dataCollector({
			query: `
				${sessionsRawCte}
				SELECT toInt64(count()) AS total FROM sessions_raw
			`,
		})
		: Promise.resolve({ data: [] as Array<{ total: number }>, err: null });

	const [{ data, err }, { data: totalData }] = await Promise.all([
		dataPromise,
		totalPromise,
	]);
	if (err) throw err;
	const rawRows = (data || []) as CodingAgentSessionRow[];

	let sliced: CodingAgentSessionRow[];
	let nextCursor: string | null;
	if (useOffset) {
		sliced = rawRows;
		nextCursor = null;
	} else {
		sliced = rawRows.slice(0, limit);
		nextCursor =
			rawRows.length > limit
				? sliced[sliced.length - 1]?.started_at || null
				: null;
	}

	const projected = await applyCohortFloor(auth, sliced, {
		since: opts.since ?? null,
		until: opts.until ?? null,
	});
	const totalRow = (totalData as Array<{ total: number | string }>) ?? [];
	const total = opts.withTotal
		? Number(totalRow[0]?.total ?? 0)
		: null;

	return {
		rows: projected,
		nextCursor,
		total,
	};
}

/**
 * Lightweight per-session rollup. Returns just the code-impact
 * counters the trace-detail header pills need (lines added/removed,
 * commits, edit accept/reject totals, PRs, acceptance pct), without
 * fetching the heavy turn/tool/MCP joins `getSession` does.
 *
 * Why this exists separately: the trace-detail page renders for
 * EVERY span the operator clicks on, including child spans like
 * `coding_agent.llm.turn` and `coding_agent.tool.call`. Those child
 * spans don't carry the session-level rollup attributes (the CLI
 * stamps them on the session-root span at SessionEnd only), so the
 * pills used to render empty on anything but the root. This helper
 * lets the UI ask "what are this session's totals?" by session_id
 * with a single tiny query so the pills stay populated regardless
 * of which span the developer is looking at.
 */
export interface CodingSessionDigest {
	session_id: string;
	lines_added: number;
	lines_removed: number;
	lines_accepted: number;
	lines_rejected: number;
	edit_accept_count: number;
	edit_reject_count: number;
	commit_count: number;
	pr_count: number;
	acceptance_pct: number;
	// Session-level usage rollups. These are populated by the same
	// dedupe pattern SESSION_BASE_COLUMNS uses (prefer the session-root
	// rollup attr when present; fall back to summing child llm.turn
	// spans for in-flight sessions). The trace-detail top cards
	// consume them so a still-running session's Tokens / Cost /
	// Duration / Model don't render as zero just because the user is
	// looking at a child span.
	total_tokens: number;
	input_tokens: number;
	output_tokens: number;
	cost_usd: number;
	duration_ms: number;
	model: string;
	// VCS / workspace context, resolved as the LATEST non-empty value
	// across the session (argMax by Timestamp, span attr preferred over
	// resource attr). A developer who switches branch / repo / folder
	// mid-session sees the current value in the header instead of the
	// session-start snapshot that the chronologically-first span (which
	// the detail view opens on) carries.
	repo_url: string;
	branch: string;
	working_dir: string;
	working_dir_label: string;
}

// SESSION_DIGEST_LOOKBACK_DAYS bounds how far back the per-session
// digest will scan `otel_traces`. Without it, every trace-detail
// page load triggered a full-history scan for a single session_id —
// fine on a fresh install, expensive once retention grows. 90 days
// matches the dispute-existence lookup window and is comfortably
// longer than the default ClickHouse retention most OSS installs
// run with.
const SESSION_DIGEST_LOOKBACK_DAYS = 90;

export async function getCodingSessionDigest(
	auth: CodingAgentAuth,
	sessionId: string,
): Promise<CodingSessionDigest | null> {
	if (!sessionId) return null;

	const sid = escape(sessionId);
	const chatScope = `(${CHAT_ID_EXPR}) = '${sid}'`;
	// The 90-day lookback bounds the worst-case full-history scan.
	// Coupled with the deterministic SpanID, a session's spans land
	// within a tight window anyway — the digest filters them out
	// via chatScope. The lookback is intentionally generous so a
	// long-running chat resumed weeks later still resolves.
	const lookbackClause = `AND Timestamp >= now() - INTERVAL ${SESSION_DIGEST_LOOKBACK_DAYS} DAY`;
	// We reuse the same greatest(rollup-attr, per-edit-sum) dual-source
	// pattern as `SESSION_BASE_COLUMNS` so this digest can never
	// disagree with the Sessions list or the full session detail
	// view — Codex (no SessionEnd hook) and in-flight sessions fall
	// back to the per-edit-span sums, completed Cursor/Claude Code
	// sessions use the session-rollup attribute. See the long
	// comment at line ~509 for the rationale.
	//
	// We also project the session owner via USER_EXPR so we can run
	// the cohort-floor check below without a second user-resolution
	// query. The route comment promised privacy enforcement; this
	// makes it actually true.
	const query = `
		SELECT
			${CHAT_ID_EXPR} AS session_id,
			${USER_EXPR} AS user,
			greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesAdded}'])),
				toInt64(sumIf(
					toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
					SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
				))
			) AS lines_added,
			greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesRemoved}'])),
				toInt64(sumIf(
					toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesRemoved}']),
					SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
				))
			) AS lines_removed,
			greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesAccepted}'])),
				toInt64(sumIf(
					toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
					SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
						AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] IN ('accept', 'auto_accepted')
				))
			) AS lines_accepted,
			greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesRejected}'])),
				toInt64(sumIf(
					toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
					SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
						AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] = 'reject'
				))
			) AS lines_rejected,
			greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditAcceptCount}'])),
				toInt64(countIf(
					SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
						AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] IN ('accept', 'auto_accepted')
				))
			) AS edit_accept_count,
			greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditRejectCount}'])),
				toInt64(countIf(
					SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
						AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] = 'reject'
				))
			) AS edit_reject_count,
			greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionCommitCount}'])),
				toInt64(countIf(SpanName = '${CODING_AGENT_SPAN_GIT_COMMIT}'))
			) AS commit_count,
			greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionPrCount}'])),
				toInt64(countIf(SpanName = '${CODING_AGENT_SPAN_GIT_PR}'))
			) AS pr_count,
			-- Session-level usage rollups. Mirrors SESSION_BASE_COLUMNS
			-- so the trace-detail header reads exactly what the
			-- Sessions list shows for the same session_id. The dedupe
			-- (anyIf-root, sumIf-non-root) is critical: the session
			-- root carries gen_ai.usage.* per OTel GenAI conventions
			-- AND every llm.turn child does the same, so a naive sum
			-- across all spans double-counts ended sessions.
			coalesce(
				nullIf(toFloat64OrZero(anyIf(
					SpanAttributes['${CODING_AGENT_ATTR.sessionCostUsd}'],
					SpanName = '${CODING_AGENT_SPAN_SESSION}'
				)), 0),
				sumOrNull(if(
					SpanName != '${CODING_AGENT_SPAN_SESSION}',
					toFloat64OrZero(SpanAttributes['${GEN_AI_ATTR.usageCost}']),
					0
				))
			) AS cost_usd,
			toInt64(coalesce(
				nullIf(toInt64OrZero(anyIf(
					SpanAttributes['${GEN_AI_ATTR.usageInputTokens}'],
					SpanName = '${CODING_AGENT_SPAN_SESSION}'
				)), 0),
				sumOrNull(if(
					SpanName != '${CODING_AGENT_SPAN_SESSION}',
					toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageInputTokens}']),
					0
				))
			)) AS input_tokens,
			toInt64(coalesce(
				nullIf(toInt64OrZero(anyIf(
					SpanAttributes['${GEN_AI_ATTR.usageOutputTokens}'],
					SpanName = '${CODING_AGENT_SPAN_SESSION}'
				)), 0),
				sumOrNull(if(
					SpanName != '${CODING_AGENT_SPAN_SESSION}',
					toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageOutputTokens}']),
					0
				))
			)) AS output_tokens,
			toInt64(coalesce(
				nullIf(toInt64OrZero(anyIf(
					SpanAttributes['${GEN_AI_ATTR.usageTotalTokens}'],
					SpanName = '${CODING_AGENT_SPAN_SESSION}'
				)), 0),
				sumOrNull(if(
					SpanName != '${CODING_AGENT_SPAN_SESSION}',
					toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageInputTokens}']) +
						toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageOutputTokens}']),
					0
				))
			)) AS total_tokens,
			-- Wall-clock session duration. Same shape as Sessions row:
			-- prefer the SessionEnd-stamped duration; fall back to
			-- (max - min) Timestamp across spans for in-flight
			-- sessions where SessionEnd hasn't fired yet. No
			-- double-count risk here (any() + max-min, not a sum).
			greatest(
				toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionDurationMs}'])),
				toInt64(toUnixTimestamp64Milli(max(Timestamp)) - toUnixTimestamp64Milli(min(Timestamp)))
			) AS duration_ms,
			-- Predominant model: the latest non-empty
			-- gen_ai.request.model across the session's child spans.
			-- argMax picks the most recent value by Timestamp so a
			-- model swap mid-session reflects the latest.
			argMaxIf(
				SpanAttributes['${GEN_AI_ATTR.requestModel}'],
				Timestamp,
				notEmpty(SpanAttributes['${GEN_AI_ATTR.requestModel}'])
			) AS model,
			-- VCS / workspace context: LATEST non-empty value across the
			-- session. We prefer the span attribute (which carries the
			-- per-turn/live value — e.g. Cursor's git_branch payload and
			-- Claude Code's transcript gitBranch) and only fall back to
			-- the resource attribute (the per-process session-start
			-- snapshot) when no span ever stamped one. argMaxIf keeps the
			-- most recent value by Timestamp so a mid-session branch /
			-- repo / folder change wins over the chronologically-first
			-- span the detail view opens on.
			coalesce(
				nullIf(argMaxIf(SpanAttributes['${VCS_ATTR.repoUrl}'], Timestamp, notEmpty(SpanAttributes['${VCS_ATTR.repoUrl}'])), ''),
				nullIf(argMaxIf(ResourceAttributes['${VCS_ATTR.repoUrl}'], Timestamp, notEmpty(ResourceAttributes['${VCS_ATTR.repoUrl}'])), ''),
				''
			) AS repo_url,
			coalesce(
				nullIf(argMaxIf(SpanAttributes['${VCS_ATTR.headRef}'], Timestamp, notEmpty(SpanAttributes['${VCS_ATTR.headRef}'])), ''),
				nullIf(argMaxIf(ResourceAttributes['${VCS_ATTR.headRef}'], Timestamp, notEmpty(ResourceAttributes['${VCS_ATTR.headRef}'])), ''),
				''
			) AS branch,
			coalesce(
				nullIf(argMaxIf(SpanAttributes['code.cwd'], Timestamp, notEmpty(SpanAttributes['code.cwd'])), ''),
				nullIf(argMaxIf(ResourceAttributes['code.cwd'], Timestamp, notEmpty(ResourceAttributes['code.cwd'])), ''),
				''
			) AS working_dir,
			arrayStringConcat(
				arraySlice(
					arrayFilter(s -> s != '', splitByChar('/',
						coalesce(
							nullIf(argMaxIf(SpanAttributes['code.cwd'], Timestamp, notEmpty(SpanAttributes['code.cwd'])), ''),
							nullIf(argMaxIf(ResourceAttributes['code.cwd'], Timestamp, notEmpty(ResourceAttributes['code.cwd'])), ''),
							''
						)
					)),
					-2
				),
				'/'
			) AS working_dir_label
		FROM ${OTEL_TRACES_TABLE}
		${whereScope({ auth })}
		${lookbackClause}
		AND ${chatScope}
		GROUP BY ${CHAT_ID_EXPR}
		LIMIT 1
	`;

	const { data, err } = await dataCollector({ query });
	if (err) throw err;
	const row = (data as Array<Record<string, unknown>> | undefined)?.[0];
	if (!row) return null;

	// Cohort floor enforcement. For non-admin viewers, we suppress
	// the digest if the session's owner has fewer than
	// COHORT_K_FLOOR sessions in the same lookback window — the
	// same rule getCodingUserDigest applies on the per-user page,
	// extended to the per-session pills so a known session_id
	// doesn't become a side channel for low-volume users' metrics.
	// Sessions where we couldn't resolve a user fall through
	// (nothing identifying to protect).
	if (auth.role !== "admin") {
		const ownerRaw = row.user;
		const owner = typeof ownerRaw === "string" ? ownerRaw : "";
		if (owner && owner !== "unknown") {
			const cohortCount = await countUserSessionsForCohort(
				auth,
				owner,
				SESSION_DIGEST_LOOKBACK_DAYS,
			);
			if (cohortCount < COHORT_K_FLOOR) {
				return null;
			}
		}
	}

	const accepts = Number(row.edit_accept_count || 0);
	const rejects = Number(row.edit_reject_count || 0);
	const decisions = accepts + rejects;
	return {
		session_id: String(row.session_id || sessionId),
		lines_added: Number(row.lines_added || 0),
		lines_removed: Number(row.lines_removed || 0),
		lines_accepted: Number(row.lines_accepted || 0),
		lines_rejected: Number(row.lines_rejected || 0),
		edit_accept_count: accepts,
		edit_reject_count: rejects,
		commit_count: Number(row.commit_count || 0),
		pr_count: Number(row.pr_count || 0),
		acceptance_pct: decisions
			? Math.round((accepts * 10000) / decisions) / 100
			: 0,
		total_tokens: Number(row.total_tokens || 0),
		input_tokens: Number(row.input_tokens || 0),
		output_tokens: Number(row.output_tokens || 0),
		cost_usd: Number(row.cost_usd || 0),
		duration_ms: Number(row.duration_ms || 0),
		model: typeof row.model === "string" ? row.model : "",
		repo_url: typeof row.repo_url === "string" ? row.repo_url : "",
		branch: typeof row.branch === "string" ? row.branch : "",
		working_dir: typeof row.working_dir === "string" ? row.working_dir : "",
		working_dir_label:
			typeof row.working_dir_label === "string" ? row.working_dir_label : "",
	};
}

// countUserSessionsForCohort returns the number of distinct
// coding-agent sessions a user owned in the trailing `windowDays`.
// Used solely to gate getCodingSessionDigest behind COHORT_K_FLOOR
// for non-admin viewers. Kept intentionally narrow — same expression
// chain as USER_EXPR / CHAT_ID_EXPR so it agrees with what the rest
// of the platform considers "the same user / the same session".
async function countUserSessionsForCohort(
	auth: CodingAgentAuth,
	userName: string,
	windowDays: number,
): Promise<number> {
	const safeUser = escape(userName);
	const lookback = `AND Timestamp >= now() - INTERVAL ${windowDays} DAY`;
	const query = `
		SELECT toInt64(count()) AS sessions
		FROM (
			SELECT ${CHAT_ID_EXPR} AS sid
			FROM ${OTEL_TRACES_TABLE}
			${whereScope({ auth })}
			${lookback}
			GROUP BY ${CHAT_ID_EXPR}, ${PER_SPAN_VENDOR_EXPR}
			HAVING ${USER_EXPR} = '${safeUser}'
		)
	`;
	const { data, err } = await dataCollector({ query });
	if (err) {
		// On error, fail closed: treat as below-floor for safety.
		// A spurious 404 is preferable to leaking the digest.
		console.error("coding_agent.session.cohort_lookup_failed", err);
		return 0;
	}
	const rows = data as Array<{ sessions?: number | string }> | undefined;
	return Number(rows?.[0]?.sessions ?? 0);
}

export interface CodingUserDigest {
	user: string;
	first_seen: string;
	last_seen: string;
	session_count: number;
	tool_call_count: number;
	cost_usd: number;
	classification_work: number;
	classification_personal: number;
	classification_unknown: number;
	classification_disputed: number;
	top_vendors: Array<{ vendor: string; sessions: number }>;
	// Per-user code-change rollups, summed across the user's
	// sessions in the working window. `acceptance_pct` is computed
	// at digest time from accepted / (accepted + rejected); 0 when
	// both are zero so the dashboard renders "—" instead of NaN.
	lines_added: number;
	lines_removed: number;
	lines_accepted: number;
	lines_rejected: number;
	edit_accept_count: number;
	edit_reject_count: number;
	acceptance_pct: number;
	commit_count: number;
	pr_count: number;
}

export interface CodingUserRow {
	user: string;
	last_seen: string;
	session_count: number;
	tool_call_count: number;
	cost_usd: number;
	// Sum of input + output gen_ai tokens across the user's sessions.
	// Used by the directory's "tokens" sort and surfaced as a token
	// chip on the row.
	total_tokens: number;
	top_vendor: string;
	classification_work: number;
	classification_personal: number;
	// Per-user code-change rollups. Same `greatest(rollup, sum)`
	// dual-source pattern used in the Sessions list — the digest
	// only diverges in that it sums across all of the user's
	// sessions instead of one.
	lines_added: number;
	lines_accepted: number;
	lines_rejected: number;
	acceptance_pct: number;
	commit_count: number;
	pr_count: number;
}

/**
 * Sort modes the Users directory exposes. The wire format matches
 * what `<CodingUsersTab>` sends in `runFilters.sortBy`.
 */
export type CodingUsersSortBy =
	| "last_seen"
	| "sessions"
	| "tool_calls"
	| "cost"
	| "tokens"
	| "work";

interface UserDigestOptions {
	since?: Date | null;
	until?: Date | null;
}

/**
 * Build a single user's roll-up suitable for the per-user page header.
 * Respects the cohort floor — when the requested user has fewer than
 * COHORT_K_FLOOR sessions and the caller is not an admin, we return
 * `null` so the route can render a 404. We deliberately do NOT mask
 * the user as "low_cohort" here because the caller already knows the
 * exact user id; rendering a digest for it would defeat the floor.
 */
export async function getCodingUserDigest(
	auth: CodingAgentAuth,
	userName: string,
	opts: UserDigestOptions = {}
): Promise<CodingUserDigest | null> {
	if (!userName) return null;
	const safeUser = escape(userName);

	// Match the row by the same coalesced user expression the
	// projector uses, so we find users keyed by the request-user or
	// service-name fallback in addition to the canonical user.name.
	// We do this by aggregating once per chat (= parent_id ?? session_id),
	// computing the user using USER_EXPR, then keeping rows where it
	// matches. Grouping by CHAT_ID_EXPR rather than raw session_id is
	// what listSessions / listCodingUsers / the dashboard widgets do,
	// so the per-user header card agrees with all of them — previously
	// subagent spawns inflated this digest's session_count vs the list.
	//
	// IMPORTANT: we materialize the per-session aggregation as a
	// subquery, NOT a `WITH per_session AS (...)` CTE. ClickHouse's
	// CTE inliner aggressively collapses `WITH ... AS` into the outer
	// SELECT, which then exposes the inner aggregates (greatest(any(),
	// countIf()) and friends) as direct arguments of the outer
	// sumOrNull / countIf / argMax calls. The planner correctly
	// rejects that as "aggregate inside aggregate". The sibling
	// `listCodingUsers` function ran into the same trap — see the
	// extended comment at the top of `baseSubquery` for the full
	// playbook. Wrapping the inner SELECT in a subquery keeps the
	// plan opaque and lets the outer aggregates run against
	// pre-materialised columns.
	const sessionsSubquery = `
		(
			SELECT
				${CHAT_ID_EXPR} AS sid,
				${USER_EXPR} AS user,
				min(Timestamp) AS first_seen,
				max(Timestamp) AS last_seen,
				countIf(SpanName = '${CODING_AGENT_SPAN_TOOL_CALL}') AS tool_calls,
				-- Canonical per-session cost. Mirrors the dedupe in
				-- SESSION_BASE_COLUMNS: prefer the authoritative
				-- root rollup; only sum **child** turn spans
				-- otherwise. Naively summing across all spans
				-- double-counts ended sessions because the root
				-- also carries gen_ai.usage.cost per OTel GenAI
				-- conventions.
				coalesce(
					nullIf(toFloat64OrZero(anyIf(
						SpanAttributes['${CODING_AGENT_ATTR.sessionCostUsd}'],
						SpanName = '${CODING_AGENT_SPAN_SESSION}'
					)), 0),
					sumOrNull(if(
						SpanName != '${CODING_AGENT_SPAN_SESSION}',
						toFloat64OrZero(SpanAttributes['${GEN_AI_ATTR.usageCost}']),
						0
					))
				) AS cost,
				-- Per-session code-change rollups. The same
				-- greatest(rollup-attr, per-edit-sum) dual-source
				-- pattern the Sessions list uses; see the
				-- SESSION_BASE_COLUMNS comment for the full
				-- rationale (Codex / in-flight sessions).
				greatest(
					toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesAdded}'])),
					toInt64(sumIf(
						toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
						SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
					))
				) AS lines_added,
				greatest(
					toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesRemoved}'])),
					toInt64(sumIf(
						toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesRemoved}']),
						SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
					))
				) AS lines_removed,
				greatest(
					toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesAccepted}'])),
					toInt64(sumIf(
						toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
						SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
							AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] IN ('accept', 'auto_accepted')
					))
				) AS lines_accepted,
				greatest(
					toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesRejected}'])),
					toInt64(sumIf(
						toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
						SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
							AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] = 'reject'
					))
				) AS lines_rejected,
				greatest(
					toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditAcceptCount}'])),
					toInt64(countIf(
						SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
							AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] IN ('accept', 'auto_accepted')
					))
				) AS edit_accept_count,
				greatest(
					toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditRejectCount}'])),
					toInt64(countIf(
						SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
							AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] = 'reject'
					))
				) AS edit_reject_count,
				greatest(
					toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionCommitCount}'])),
					toInt64(countIf(SpanName = '${CODING_AGENT_SPAN_GIT_COMMIT}'))
				) AS commit_count,
				greatest(
					toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionPrCount}'])),
					toInt64(countIf(SpanName = '${CODING_AGENT_SPAN_GIT_PR}'))
				) AS pr_count,
				coalesce(nullIf(any(SpanAttributes['${CODING_AGENT_ATTR.userClassification}']), ''), 'unknown') AS classification,
				${VENDOR_EXPR} AS vendor
			FROM ${OTEL_TRACES_TABLE}
			${whereScope({
				since: opts.since ?? null,
				until: opts.until ?? null,
				auth,
			})}
			GROUP BY ${CHAT_ID_EXPR}, ${PER_SPAN_VENDOR_EXPR}
		)
	`;

	// Two-stage aggregation. The inner SELECT does ALL the aggregate
	// work and the outer SELECT only does scalar arithmetic on its
	// columns. Why split it: ClickHouse 24.x resolves a bare
	// `edit_accept_count` inside the outer SELECT to the aliased
	// expression `sumOrNull(edit_accept_count) AS edit_accept_count`
	// if the alias was declared on the same row (default
	// `prefer_column_name_to_alias=0`). That turns
	// `if(... sumOrNull(edit_accept_count) ...)` into
	// `if(... sumOrNull(sumOrNull(edit_accept_count)) ...)`, which
	// the planner correctly rejects as a nested aggregate. Putting
	// the aggregates one layer down dodges the alias shadowing
	// entirely and keeps the outer SELECT pure scalar.
	const digestQuery = `
		SELECT
			user,
			first_seen,
			last_seen,
			session_count,
			tool_call_count,
			cost_usd,
			classification_work,
			classification_personal,
			classification_disputed,
			classification_unknown,
			lines_added,
			lines_removed,
			lines_accepted,
			lines_rejected,
			edit_accept_count,
			edit_reject_count,
			commit_count,
			pr_count,
			if(
				(edit_accept_count + edit_reject_count) = 0,
				toFloat64(0),
				round(
					toFloat64(edit_accept_count) * 100 /
					toFloat64(edit_accept_count + edit_reject_count),
					2
				)
			) AS acceptance_pct
		FROM (
			SELECT
				'${safeUser}' AS user,
				formatDateTime(min(first_seen), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS first_seen,
				formatDateTime(max(last_seen), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS last_seen,
				toInt64(count())                                 AS session_count,
				toInt64(sum(tool_calls))                         AS tool_call_count,
				round(sumOrNull(cost), 4)                        AS cost_usd,
				toInt64(countIf(classification = 'work'))        AS classification_work,
				toInt64(countIf(classification = 'personal'))    AS classification_personal,
				toInt64(countIf(classification = 'disputed'))    AS classification_disputed,
				toInt64(countIf(classification = 'unknown'))     AS classification_unknown,
				toInt64(sumOrNull(lines_added))                  AS lines_added,
				toInt64(sumOrNull(lines_removed))                AS lines_removed,
				toInt64(sumOrNull(lines_accepted))               AS lines_accepted,
				toInt64(sumOrNull(lines_rejected))               AS lines_rejected,
				toInt64(sumOrNull(edit_accept_count))            AS edit_accept_count,
				toInt64(sumOrNull(edit_reject_count))            AS edit_reject_count,
				toInt64(sumOrNull(commit_count))                 AS commit_count,
				toInt64(sumOrNull(pr_count))                     AS pr_count
			FROM ${sessionsSubquery} AS per_session
			WHERE user = '${safeUser}'
		) totals
	`;

	const vendorsQuery = `
		SELECT vendor, toInt64(count()) AS sessions
		FROM ${sessionsSubquery} AS per_session
		WHERE user = '${safeUser}'
		GROUP BY vendor
		HAVING vendor != '' AND vendor != 'unknown'
		ORDER BY sessions DESC
		LIMIT 5
	`;

	const [{ data: digestData, err: digestErr }, { data: vendorsData }] =
		await Promise.all([
			dataCollector({ query: digestQuery }),
			dataCollector({ query: vendorsQuery }),
		]);
	if (digestErr) throw digestErr;
	const digestRow = (digestData as CodingUserDigest[] | undefined)?.[0];
	if (!digestRow || !Number(digestRow.session_count)) return null;

	const sessionCount = Number(digestRow.session_count || 0);
	if (auth.role !== "admin" && sessionCount < COHORT_K_FLOOR) {
		// Privacy floor — don't reveal a profile for a user who barely
		// shows up. Treated as "not found" by the route.
		return null;
	}

	return {
		...digestRow,
		session_count: sessionCount,
		tool_call_count: Number(digestRow.tool_call_count || 0),
		cost_usd: Number(digestRow.cost_usd || 0),
		classification_work: Number(digestRow.classification_work || 0),
		classification_personal: Number(digestRow.classification_personal || 0),
		classification_unknown: Number(digestRow.classification_unknown || 0),
		classification_disputed: Number(digestRow.classification_disputed || 0),
		lines_added: Number(digestRow.lines_added || 0),
		lines_removed: Number(digestRow.lines_removed || 0),
		lines_accepted: Number(digestRow.lines_accepted || 0),
		lines_rejected: Number(digestRow.lines_rejected || 0),
		edit_accept_count: Number(digestRow.edit_accept_count || 0),
		edit_reject_count: Number(digestRow.edit_reject_count || 0),
		commit_count: Number(digestRow.commit_count || 0),
		pr_count: Number(digestRow.pr_count || 0),
		acceptance_pct: Number(digestRow.acceptance_pct || 0),
		top_vendors: ((vendorsData as Array<{ vendor: string; sessions: number | string }>) || []).map(
			(row) => ({
				vendor: row.vendor,
				sessions: Number(row.sessions || 0),
			})
		),
	};
}

/**
 * Org-wide list of coding-agent users. The directory tab uses this; we
 * apply the same cohort floor — users below COHORT_K_FLOOR are
 * collapsed into a single `low_cohort` row when the viewer isn't admin
 * (matches the behavior of the sessions list).
 */
export interface ListCodingUsersOptions {
	limit?: number;
	offset?: number;
	since?: Date | null;
	until?: Date | null;
	vendor?: string | null;
	withTotal?: boolean;
	sortBy?: CodingUsersSortBy;
	sortDir?: "asc" | "desc";
}

// Maps the user-facing `sortBy` enum to the column expression in the
// `users_raw` CTE. Centralised so it stays in lock-step with the
// SELECT clause.
const USERS_SORT_COLUMNS: Record<CodingUsersSortBy, string> = {
	last_seen: "last_seen",
	sessions: "session_count",
	tool_calls: "tool_call_count",
	cost: "cost_usd",
	tokens: "total_tokens",
	work: "classification_work",
};

export async function listCodingUsers(
	auth: CodingAgentAuth,
	opts: ListCodingUsersOptions = {}
): Promise<{ rows: CodingUserRow[]; total: number | null }> {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const offset = Math.max(opts.offset ?? 0, 0);
	const vendorClause = opts.vendor
		? `AND vendor = '${escape(opts.vendor)}'`
		: "";

	const sortBy: CodingUsersSortBy = opts.sortBy || "last_seen";
	const sortDir = opts.sortDir === "asc" ? "ASC" : "DESC";
	const orderColumn = USERS_SORT_COLUMNS[sortBy] || "last_seen";
	// Always tie-break by last_seen so "0 sessions" rows don't shuffle
	// arbitrarily between requests.
	const orderClause = `ORDER BY ${orderColumn} ${sortDir}, last_seen DESC`;

	// Cohort floor applied IN SQL for non-admins. Previously this ran
	// after LIMIT/OFFSET in JS, which meant low-volume users could
	// land on page 1 then collapse into `low_cohort` after, skewing
	// totals + pagination. Doing it inside the CTE keeps the page,
	// total, and sort order consistent for the viewer.
	const isAdmin = auth.role === "admin";
	const cohortProjectExpr = isAdmin
		? "user"
		: `if(session_count < ${COHORT_K_FLOOR} AND user NOT IN ('unknown', ''), 'low_cohort', user)`;

	// Two-stage CTE: compute one row per chat thread with the coalesced
	// user/vendor identity, then aggregate by user. We bucket by
	// chat_id (= parent_id when this is a subagent, else session_id)
	// so a parent + N subagents counts as ONE session for the user,
	// matching what the Sessions list shows them.
	// Implementation note: ClickHouse inlines `WITH ... AS` CTEs and
	// then bans aggregate-inside-aggregate (`max(formatDateTime(max(...)))`,
	// `argMax(top_vendor, max(last_ts))`). We dodge this by:
	//   1. Carrying the raw `max(Timestamp)` through as a plain
	//      DateTime column (`*_last_ts`) and only formatting at the
	//      outermost SELECT.
	//   2. Aliasing each layer's aggregates with distinct names so the
	//      inliner can't collapse them into nested aggregates.
	//   3. Using subqueries instead of `WITH` so the plan stays
	//      explicit even on older ClickHouse versions that inline
	//      aggressively.
	// The cohort collapse stays in SQL so it applies *before* LIMIT —
	// otherwise low-volume users could land on page 1 then disappear
	// after JS masking, breaking pagination.
	const baseSubquery = `
		FROM (
			SELECT
				${cohortProjectExpr} AS user,
				max(per_user_last_ts) AS user_last_ts,
				toInt64(sum(per_user_session_count)) AS session_count,
				toInt64(sum(per_user_tool_calls)) AS tool_call_count,
				round(sumOrNull(per_user_cost), 4) AS cost_usd,
				toInt64(sum(per_user_tokens)) AS total_tokens,
				argMax(per_user_top_vendor, per_user_last_ts) AS top_vendor,
				toInt64(sum(per_user_class_work)) AS classification_work,
				toInt64(sum(per_user_class_personal)) AS classification_personal,
				toInt64(sum(per_user_lines_added)) AS lines_added,
				toInt64(sum(per_user_lines_accepted)) AS lines_accepted,
				toInt64(sum(per_user_lines_rejected)) AS lines_rejected,
				toInt64(sum(per_user_edit_accept)) AS edit_accept_count,
				toInt64(sum(per_user_edit_reject)) AS edit_reject_count,
				toInt64(sum(per_user_commits)) AS commit_count,
				toInt64(sum(per_user_prs)) AS pr_count
			FROM (
				SELECT
					user AS user,
					max(session_last_ts) AS per_user_last_ts,
					toInt64(count()) AS per_user_session_count,
					toInt64(sum(tool_calls)) AS per_user_tool_calls,
					round(sumOrNull(cost), 4) AS per_user_cost,
					toInt64(sumOrNull(tokens)) AS per_user_tokens,
					argMax(vendor, session_last_ts) AS per_user_top_vendor,
					toInt64(countIf(classification = 'work')) AS per_user_class_work,
					toInt64(countIf(classification = 'personal')) AS per_user_class_personal,
					toInt64(sumOrNull(lines_added)) AS per_user_lines_added,
					toInt64(sumOrNull(lines_accepted)) AS per_user_lines_accepted,
					toInt64(sumOrNull(lines_rejected)) AS per_user_lines_rejected,
					toInt64(sumOrNull(edit_accept)) AS per_user_edit_accept,
					toInt64(sumOrNull(edit_reject)) AS per_user_edit_reject,
					toInt64(sumOrNull(commits)) AS per_user_commits,
					toInt64(sumOrNull(prs)) AS per_user_prs
				FROM (
					SELECT
						${CHAT_ID_EXPR} AS sid,
						${USER_EXPR} AS user,
						${VENDOR_EXPR} AS vendor,
						max(Timestamp) AS session_last_ts,
						countIf(SpanName = '${CODING_AGENT_SPAN_TOOL_CALL}') AS tool_calls,
						-- Canonical per-session cost: same dedupe as
						-- listSessions / getCodingUserDigest. Without
						-- this the Users tab would silently lag
						-- behind the authoritative session-end total
						-- AND double-count ended sessions (root +
						-- per-turn both carry gen_ai.usage.cost per
						-- OTel GenAI conventions).
						coalesce(
							nullIf(toFloat64OrZero(anyIf(
								SpanAttributes['${CODING_AGENT_ATTR.sessionCostUsd}'],
								SpanName = '${CODING_AGENT_SPAN_SESSION}'
							)), 0),
							sumOrNull(if(
								SpanName != '${CODING_AGENT_SPAN_SESSION}',
								toFloat64OrZero(SpanAttributes['${GEN_AI_ATTR.usageCost}']),
								0
							))
						) AS cost,
						-- Tokens: same dedupe as cost (root carries
						-- gen_ai.usage.*_tokens at SessionEnd; child
						-- turn spans carry per-turn counts).
						coalesce(
							nullIf(toInt64OrZero(anyIf(
								SpanAttributes['${GEN_AI_ATTR.usageTotalTokens}'],
								SpanName = '${CODING_AGENT_SPAN_SESSION}'
							)), 0),
							sumOrNull(if(
								SpanName != '${CODING_AGENT_SPAN_SESSION}',
								toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageInputTokens}']) +
									toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageOutputTokens}']),
								0
							))
						) AS tokens,
						-- Per-session code-change rollups (same
						-- dual-source pattern as listSessions /
						-- getCodingUserDigest). The user-list page
						-- only renders summed metrics, so we don't
						-- emit lines_removed here.
						greatest(
							toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesAdded}'])),
							toInt64(sumIf(
								toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
								SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
							))
						) AS lines_added,
						greatest(
							toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesAccepted}'])),
							toInt64(sumIf(
								toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
								SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
									AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] IN ('accept', 'auto_accepted')
							))
						) AS lines_accepted,
						greatest(
							toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionLinesRejected}'])),
							toInt64(sumIf(
								toInt64OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}']),
								SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
									AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] = 'reject'
							))
						) AS lines_rejected,
						greatest(
							toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditAcceptCount}'])),
							toInt64(countIf(
								SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
									AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] IN ('accept', 'auto_accepted')
							))
						) AS edit_accept,
						greatest(
							toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionEditRejectCount}'])),
							toInt64(countIf(
								SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
									AND SpanAttributes['${CODING_AGENT_ATTR.editDecision}'] = 'reject'
							))
						) AS edit_reject,
						greatest(
							toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionCommitCount}'])),
							toInt64(countIf(SpanName = '${CODING_AGENT_SPAN_GIT_COMMIT}'))
						) AS commits,
						greatest(
							toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionPrCount}'])),
							toInt64(countIf(SpanName = '${CODING_AGENT_SPAN_GIT_PR}'))
						) AS prs,
						coalesce(nullIf(any(SpanAttributes['${CODING_AGENT_ATTR.userClassification}']), ''), 'unknown') AS classification
					FROM ${OTEL_TRACES_TABLE}
					${whereScope({
						since: opts.since ?? null,
						until: opts.until ?? null,
						auth,
					})}
					GROUP BY sid, ${PER_SPAN_VENDOR_EXPR}
				) per_session
				WHERE user != ''
					${vendorClause}
				GROUP BY user
				HAVING user != ''
			) per_user
			GROUP BY 1
		) users_raw
	`;

	// users_raw exposes user_last_ts as a raw DateTime; format here so
	// the ORDER BY can still sort on the raw column without triggering
	// nested aggregates in the planner.
	const dataQuery = `
		SELECT
			user,
			formatDateTime(user_last_ts, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS last_seen,
			session_count,
			tool_call_count,
			cost_usd,
			total_tokens,
			top_vendor,
			classification_work,
			classification_personal,
			lines_added,
			lines_accepted,
			lines_rejected,
			commit_count,
			pr_count,
			if(
				(edit_accept_count + edit_reject_count) = 0,
				toFloat64(0),
				round(toFloat64(edit_accept_count) * 100 / toFloat64(edit_accept_count + edit_reject_count), 2)
			) AS acceptance_pct
		${baseSubquery}
		${orderClause.replace(/last_seen/g, "user_last_ts")}
		LIMIT ${limit}
		OFFSET ${offset}
	`;

	const totalPromise = opts.withTotal
		? dataCollector({
			query: `SELECT toInt64(count()) AS total ${baseSubquery}`,
		})
		: Promise.resolve({ data: [] as Array<{ total: number }>, err: null });

	const [{ data, err }, { data: totalData }] = await Promise.all([
		dataCollector({ query: dataQuery }),
		totalPromise,
	]);
	if (err) throw err;

	// Cohort floor is applied in SQL above; we just normalize types.
	const rows = ((data as CodingUserRow[]) || []).map((row) => ({
		...row,
		session_count: Number(row.session_count || 0),
		tool_call_count: Number(row.tool_call_count || 0),
		cost_usd: Number(row.cost_usd || 0),
		total_tokens: Number(row.total_tokens || 0),
		classification_work: Number(row.classification_work || 0),
		classification_personal: Number(row.classification_personal || 0),
		lines_added: Number(row.lines_added || 0),
		lines_accepted: Number(row.lines_accepted || 0),
		lines_rejected: Number(row.lines_rejected || 0),
		acceptance_pct: Number(row.acceptance_pct || 0),
		commit_count: Number(row.commit_count || 0),
		pr_count: Number(row.pr_count || 0),
	}));

	const totalRow = (totalData as Array<{ total: number | string }>) ?? [];
	const total = opts.withTotal ? Number(totalRow[0]?.total ?? 0) : null;

	return { rows, total };
}

/**
 * Replace `user` with the literal "low_cohort" when the user shows up
 * fewer than COHORT_K_FLOOR times in the working window AND the
 * caller is not an admin. Admin can always see the raw value (the
 * audit log captures the access).
 *
 * Phase B3: the cohort window is bounded to the same `since`/`until`
 * the caller asked about (default: 24h). Previously this scanned all
 * of `otel_traces` which was both a privacy hazard (users active a
 * month ago could be re-identified by a recent session) and a scale
 * cost (full-table scan per list page).
 *
 * For v1 we run a single rollup count query once per call rather
 * than per-row to keep latency down.
 */
async function applyCohortFloor<T extends { user: string }>(
	auth: CodingAgentAuth,
	rows: T[],
	opts: { since?: Date | null; until?: Date | null } = {}
): Promise<T[]> {
	if (auth.role === "admin" || rows.length === 0) return rows;

	// Distinct user values to look up. We also exclude the
	// "unknown" sentinel — it's already a privacy bucket; suppressing
	// it further would just hide all rows for orgs whose CLI is
	// pre-user-emit. Admin still sees raw rows above.
	const distinctUsers = Array.from(
		new Set(
			rows
				.map((r) => r.user)
				.filter((u) => Boolean(u) && u !== "unknown" && u !== "low_cohort")
		)
	);
	if (distinctUsers.length === 0) return rows;

	const inList = distinctUsers.map((u) => `'${escape(u)}'`).join(", ");
	// We count chat threads, not raw spans, using the SAME chat-id
	// rollup the projector uses (parent_id → session_id). A user with
	// 4 small subagents under 1 parent counts as 1 session, matching
	// what the UI shows them.
	const query = `
		WITH per_session AS (
			SELECT
				${USER_EXPR} AS user,
				${CHAT_ID_EXPR} AS sid
			FROM ${OTEL_TRACES_TABLE}
			${whereScope({
				since: opts.since ?? null,
				until: opts.until ?? null,
				auth,
			})}
			GROUP BY sid, ${PER_SPAN_VENDOR_EXPR}
		)
		SELECT user, CAST(count() AS INTEGER) AS sessions
		FROM per_session
		WHERE user IN (${inList})
		GROUP BY user
	`;
	const { data, err } = await dataCollector({ query });
	if (err) throw err;
	const counts = new Map<string, number>();
	for (const row of (data || []) as { user: string; sessions: number }[]) {
		counts.set(row.user, Number(row.sessions || 0));
	}

	return rows.map((r) => {
		if (!r.user || r.user === "unknown" || r.user === "low_cohort") return r;
		const c = counts.get(r.user) ?? 0;
		if (c < COHORT_K_FLOOR) {
			return { ...r, user: "low_cohort" } as T;
		}
		return r;
	});
}

/**
 * Persist a classification dispute and emit an audit log entry. The
 * dispute table holds the full lifecycle (open → accepted/rejected/withdrawn);
 * the audit log captures the submission as a discrete event so we can
 * paginate "recent governance activity" without scanning the disputes
 * table.
 *
 * Both writes are best-effort sequential: if the audit insert fails
 * we still keep the dispute (the dispute table is the source of truth
 * for downstream review), but we log loudly. The reverse — dispute
 * fail, audit succeed — is rejected up front by throwing the dispute
 * error before we attempt the audit row.
 */
// E4 hardening constants. Numbers are intentionally generous for
// beta — the goal is to block trivial scripted abuse without
// throttling legitimate UI activity. Tune downward if we observe
// abuse in production.
const DISPUTE_RATE_LIMIT_WINDOW_MIN = 60;
const DISPUTE_RATE_LIMIT_MAX_PER_WINDOW = 20;

export class DisputeError extends Error {
	readonly code: "not_found" | "duplicate" | "rate_limited";
	readonly status: number;
	constructor(
		code: DisputeError["code"],
		status: number,
		message: string
	) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

// sessionExists checks whether the chat-id rolled-up
// session is actually visible. Org scoping is enforced by
// `dataCollector` picking the per-org ClickHouse database (see
// `whereScope` for the explanation), so we don't need to wrap the
// org id in the SQL. We do still constrain to coding-agent span
// names so a request can't probe arbitrary trace ids.
async function disputeSessionExists(
	_auth: CodingAgentAuth,
	sessionId: string
): Promise<boolean> {
	const sid = escape(sessionId);
	const query = `
		SELECT 1 AS hit
		FROM ${OTEL_TRACES_TABLE}
		WHERE SpanName IN (${CODING_AGENT_SPAN_NAMES.map((n) => `'${n}'`).join(", ")})
			AND Timestamp >= now() - INTERVAL 90 DAY
			AND (
				SpanAttributes['${CODING_AGENT_ATTR.sessionId}'] = '${sid}'
				OR ${CHAT_ID_EXPR.trim()} = '${sid}'
			)
		LIMIT 1
	`;
	const { data, err } = await dataCollector({ query });
	if (err) {
		// Treat lookup failure as "not present" — better to reject a
		// dispute than to accept one that points at a non-existent
		// session and leave the audit log polluted.
		console.error("coding_agent.dispute.session_lookup_failed", err);
		return false;
	}
	return Array.isArray(data) && data.length > 0;
}

// disputeAlreadyExists guards against duplicate open disputes from
// the same user on the same session. We allow resubmission once a
// previous dispute has been resolved (the admin reviewed and either
// accepted or rejected it) so users can re-dispute after a policy
// change, but not while one is still open.
async function disputeAlreadyExists(
	auth: CodingAgentAuth,
	sessionId: string
): Promise<boolean> {
	const orgId = escape(auth.organizationId);
	const userId = escape(auth.userId);
	const sid = escape(sessionId);
	const query = `
		SELECT 1 AS hit
		FROM ${CODING_AGENT_DISPUTES_TABLE}
		WHERE organization_id = '${orgId}'
			AND user_id = '${userId}'
			AND session_id = '${sid}'
			AND status = 'open'
		LIMIT 1
	`;
	const { data, err } = await dataCollector({ query });
	if (err) {
		// Fail-closed: a lookup failure here means we can't tell if an
		// open dispute already exists. The cost of a false-positive
		// ("you already have an open dispute") is one extra click for
		// the user, but the cost of a false-negative is a duplicate
		// open dispute that pollutes the audit + governance queues.
		// Surface as "exists" so the caller blocks the new write.
		console.error("coding_agent.dispute.dedupe_lookup_failed", err);
		return true;
	}
	return Array.isArray(data) && data.length > 0;
}

// disputeRateLimitExceeded asks ClickHouse rather than holding
// in-memory state because the API runs on multiple Next.js workers
// and an in-memory counter would be per-worker. The audit log is
// the right place to count from — it's already append-only and
// indexed on (organization_id, created_at).
async function disputeRateLimitExceeded(
	auth: CodingAgentAuth
): Promise<boolean> {
	const orgId = escape(auth.organizationId);
	const userId = escape(auth.userId);
	const query = `
		SELECT count() AS n
		FROM ${CODING_AGENT_AUDIT_LOG_TABLE}
		WHERE organization_id = '${orgId}'
			AND user_id = '${userId}'
			AND action = 'coding_agent.classification.dispute'
			AND created_at >= now() - INTERVAL ${DISPUTE_RATE_LIMIT_WINDOW_MIN} MINUTE
	`;
	const { data, err } = await dataCollector({ query });
	if (err) {
		// Fail-closed: a lookup failure must NOT degrade into "no rate
		// limit applied" — that turns this guard into a bypass-on-error
		// vector. We reject the new dispute so a temporary ClickHouse
		// blip can't let a script flood the audit log. The user can
		// retry once telemetry is back; in practice this fires <0.1%
		// of submissions.
		console.error("coding_agent.dispute.rate_limit_lookup_failed", err);
		return true;
	}
	const rows = data as Array<{ n?: number | string }> | undefined;
	const n = Number(rows?.[0]?.n ?? 0);
	return n >= DISPUTE_RATE_LIMIT_MAX_PER_WINDOW;
}

export async function submitClassificationDispute(
	auth: CodingAgentAuth,
	input: CodingAgentClassificationDispute
): Promise<{ id: string }> {
	// Order matters: existence first (cheap rejection of probes),
	// dedupe next (prevents flooding the table), rate limit last
	// (most expensive query, only run if the request is otherwise
	// valid).
	const exists = await disputeSessionExists(auth, input.sessionId);
	if (!exists) {
		throw new DisputeError(
			"not_found",
			404,
			"Session does not exist or is outside your access scope"
		);
	}

	const duplicate = await disputeAlreadyExists(auth, input.sessionId);
	if (duplicate) {
		throw new DisputeError(
			"duplicate",
			409,
			"An open dispute already exists for this session"
		);
	}

	const limited = await disputeRateLimitExceeded(auth);
	if (limited) {
		throw new DisputeError(
			"rate_limited",
			429,
			`Too many disputes in the last ${DISPUTE_RATE_LIMIT_WINDOW_MIN} minutes`
		);
	}

	const id = crypto.randomUUID();

	const { err: disputeErr } = await dataCollector(
		{
			table: CODING_AGENT_DISPUTES_TABLE,
			values: [
				{
					id,
					organization_id: auth.organizationId,
					session_id: input.sessionId,
					user_id: auth.userId,
					current_classification: input.currentClassification,
					requested_classification: input.requestedClassification,
					rationale: input.rationale,
					status: "open",
				},
			],
		},
		"insert"
	);
	if (disputeErr) throw disputeErr;

	await writeAuditLog(auth, {
		action: "coding_agent.classification.dispute",
		subject: input.sessionId,
		payload: JSON.stringify({
			disputeId: id,
			from: input.currentClassification,
			to: input.requestedClassification,
		}),
	});

	return { id };
}

export async function writeAuditLog(
	auth: CodingAgentAuth,
	entry: { action: string; subject?: string; payload?: string }
): Promise<void> {
	const { err } = await dataCollector(
		{
			table: CODING_AGENT_AUDIT_LOG_TABLE,
			values: [
				{
					organization_id: auth.organizationId,
					user_id: auth.userId,
					action: entry.action,
					subject: entry.subject || "",
					payload: entry.payload || "",
				},
			],
		},
		"insert"
	);
	if (err) {
		// We don't throw on audit failure — the user-visible action
		// already succeeded, and surfacing a 500 here would falsely
		// imply data loss. Instead we surface to server logs so SRE
		// can detect and replay.
		console.error("coding_agent.audit_log.insert_failed", err);
	}
}

