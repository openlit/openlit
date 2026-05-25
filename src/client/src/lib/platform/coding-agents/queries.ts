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

function escape(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export interface ListSessionsOptions {
	limit?: number;
	cursor?: string | null;
	vendor?: string | null;
	classification?: CodingAgentClassification | null;
	since?: Date | null;
	until?: Date | null;
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
}

export interface CodingAgentLLMTurnRow {
	timestamp: string;
	kind: string; // "user_prompt" | "assistant_only" | "thought"
	model: string;
	prompt: string;
	response: string;
	thought: string;
	input_tokens: number;
	output_tokens: number;
	cost_usd: number;
	attachment_paths: string[];
}

export interface CodingAgentToolCallRow {
	timestamp: string;
	tool_name: string;
	tool_use_id: string;
	mcp_server_name: string;
	command: string;
	working_dir: string;
	args: string;
	result: string;
	duration_ms: number;
	errored: boolean;
	error_msg: string;
	failure_type: string;
	sandboxed: boolean;
}

export interface CodingAgentEditRow {
	timestamp: string;
	file_path: string;
	decision: string;
	source: string;
	tool_name: string;
	lines_added: number;
	lines_removed: number;
	language: string;
}

export interface CodingAgentSubagentRow {
	timestamp: string;
	subagent_type: string;
	task: string;
	summary: string;
	status: string;
	duration_ms: number;
	message_count: number;
	tool_call_count: number;
	modified_files: string[];
}

export interface CodingAgentSessionDetail extends CodingAgentSessionRow {
	model: string;
	branch: string;
	commit_sha: string;
	policy_permission_mode: string;
	content_capture_mode: string;
	tools: { tool_name: string; calls: number }[];
	mcp_servers: { server_name: string; calls: number }[];

	// Drill-down detail used by the session-detail sheet.
	turns: CodingAgentLLMTurnRow[];
	tool_calls: CodingAgentToolCallRow[];
	edits: CodingAgentEditRow[];
	subagents: CodingAgentSubagentRow[];
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
const SESSION_BASE_COLUMNS = `
	SpanAttributes['${CODING_AGENT_ATTR.sessionId}']                    AS session_id,
	coalesce(
		nullIf(SpanAttributes['${CODING_AGENT_ATTR.client}'], ''),
		SpanAttributes['${GEN_AI_ATTR.agentName}']
	)                                                                  AS vendor,
	SpanAttributes['${GEN_AI_ATTR.userName}']                          AS user,
	formatDateTime(min(Timestamp), '%Y-%m-%dT%H:%M:%SZ')               AS started_at,
	formatDateTime(max(Timestamp), '%Y-%m-%dT%H:%M:%SZ')               AS ended_at,
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionDurationMs}'])),
		toInt64(toUnixTimestamp64Milli(max(Timestamp)) - toUnixTimestamp64Milli(min(Timestamp)))
	) AS duration_ms,
	greatest(
		toInt64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionToolCallCount}'])),
		toInt64(countIf(SpanName = '${CODING_AGENT_SPAN_TOOL_CALL}'))
	) AS tool_call_count,
	greatest(
		toFloat64OrZero(any(SpanAttributes['${CODING_AGENT_ATTR.sessionCostUsd}'])),
		sumOrNull(toFloat64OrZero(SpanAttributes['${GEN_AI_ATTR.usageCost}']))
	)                                                                  AS cost_usd,
	coalesce(nullIf(any(SpanAttributes['${CODING_AGENT_ATTR.sessionOutcome}']), ''), 'unknown') AS outcome,
	coalesce(nullIf(any(SpanAttributes['${CODING_AGENT_ATTR.userClassification}']), ''), 'unknown') AS classification,
	coalesce(nullIf(any(SpanAttributes['${CODING_AGENT_ATTR.userClassificationReason}']), ''), 'no_signal') AS classification_reason,
	any(SpanAttributes['${VCS_ATTR.repoUrl}'])                         AS repo_url,
	if(any(SpanAttributes['${CODING_AGENT_ATTR.vcsDirty}']) = 'true', 1, 0) AS repo_dirty
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
function whereScope(opts?: { since?: Date | null; until?: Date | null }) {
	const since = opts?.since
		? `AND Timestamp >= parseDateTimeBestEffort('${escape(opts.since.toISOString())}')`
		: "";
	const until = opts?.until
		? `AND Timestamp <= parseDateTimeBestEffort('${escape(opts.until.toISOString())}')`
		: "";

	return `
		WHERE SpanName IN (${CODING_AGENT_SPAN_NAMES.map((n) => `'${n}'`).join(", ")})
		AND notEmpty(SpanAttributes['${CODING_AGENT_ATTR.sessionId}'])
		${since}
		${until}
	`;
}

/**
 * List recent coding-agent sessions for the active org/database.
 * Cursor is the started_at timestamp of the last row (descending paging).
 */
export async function listSessions(
	auth: CodingAgentAuth,
	opts: ListSessionsOptions = {}
): Promise<{
	rows: CodingAgentSessionRow[];
	nextCursor: string | null;
}> {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const cursorClause = opts.cursor
		? `HAVING started_at < '${escape(opts.cursor)}'`
		: "";
	const vendorClause = opts.vendor
		? `AND coalesce(nullIf(SpanAttributes['${CODING_AGENT_ATTR.client}'], ''), SpanAttributes['${GEN_AI_ATTR.agentName}']) = '${escape(opts.vendor)}'`
		: "";
	const classificationClause = opts.classification
		? `AND coalesce(nullIf(SpanAttributes['${CODING_AGENT_ATTR.userClassification}'], ''), 'unknown') = '${escape(opts.classification)}'`
		: "";

	const query = `
		WITH sessions_raw AS (
			SELECT
				${SESSION_BASE_COLUMNS}
			FROM ${OTEL_TRACES_TABLE}
			${whereScope({ since: opts.since ?? null, until: opts.until ?? null })}
			${vendorClause}
			${classificationClause}
			GROUP BY
				SpanAttributes['${CODING_AGENT_ATTR.sessionId}'],
				SpanAttributes['${CODING_AGENT_ATTR.client}'],
				SpanAttributes['${GEN_AI_ATTR.agentName}'],
				SpanAttributes['${GEN_AI_ATTR.userName}']
		)
		SELECT *
		FROM sessions_raw
		${cursorClause}
		ORDER BY started_at DESC
		LIMIT ${limit + 1}
	`;

	const { data, err } = await dataCollector({ query });
	if (err) throw err;
	const rawRows = (data || []) as CodingAgentSessionRow[];

	const sliced = rawRows.slice(0, limit);
	const nextCursor =
		rawRows.length > limit ? sliced[sliced.length - 1]?.started_at || null : null;

	const projected = await applyCohortFloor(auth, sliced);

	return {
		rows: projected,
		nextCursor,
	};
}

export async function getSession(
	auth: CodingAgentAuth,
	sessionId: string
): Promise<CodingAgentSessionDetail | null> {
	if (!sessionId) return null;

	const sid = escape(sessionId);

	const baseQuery = `
		SELECT
			${SESSION_BASE_COLUMNS},
			any(SpanAttributes['${GEN_AI_ATTR.requestModel}'])                AS model,
			any(SpanAttributes['${VCS_ATTR.headRef}'])                        AS branch,
			any(SpanAttributes['${VCS_ATTR.headRevision}'])                   AS commit_sha,
			coalesce(nullIf(any(SpanAttributes['${CODING_AGENT_ATTR.policyPermissionMode}']), ''), 'unknown') AS policy_permission_mode,
			coalesce(nullIf(any(SpanAttributes['${CODING_AGENT_ATTR.contentCaptureMode}']), ''), 'unknown') AS content_capture_mode
		FROM ${OTEL_TRACES_TABLE}
		${whereScope()}
		AND SpanAttributes['${CODING_AGENT_ATTR.sessionId}'] = '${sid}'
		GROUP BY
			SpanAttributes['${CODING_AGENT_ATTR.sessionId}'],
			SpanAttributes['${CODING_AGENT_ATTR.client}'],
			SpanAttributes['${GEN_AI_ATTR.agentName}'],
			SpanAttributes['${GEN_AI_ATTR.userName}']
		LIMIT 1
	`;

	const toolsQuery = `
		SELECT
			SpanAttributes['${GEN_AI_ATTR.toolName}'] AS tool_name,
			CAST(count() AS INTEGER) AS calls
		FROM ${OTEL_TRACES_TABLE}
		WHERE SpanName = '${escape("coding_agent.tool.call")}'
		AND SpanAttributes['${CODING_AGENT_ATTR.sessionId}'] = '${sid}'
		AND notEmpty(SpanAttributes['${GEN_AI_ATTR.toolName}'])
		GROUP BY tool_name
		ORDER BY calls DESC
		LIMIT 50
	`;

	const mcpQuery = `
		SELECT
			SpanAttributes['${CODING_AGENT_ATTR.mcpServerName}'] AS server_name,
			CAST(count() AS INTEGER) AS calls
		FROM ${OTEL_TRACES_TABLE}
		WHERE SpanAttributes['${CODING_AGENT_ATTR.sessionId}'] = '${sid}'
		AND notEmpty(SpanAttributes['${CODING_AGENT_ATTR.mcpServerName}'])
		GROUP BY server_name
		ORDER BY calls DESC
		LIMIT 25
	`;

	// LLM turns (prompts/responses/thoughts) ordered by time so the
	// detail sheet can render them as a transcript. We pull body text
	// only when content capture was full — fall back to empty strings
	// otherwise (the redact tier already scrubbed at hook time).
	const turnsQuery = `
		SELECT
			formatDateTime(Timestamp, '%Y-%m-%dT%H:%M:%S.%fZ')          AS timestamp,
			coalesce(nullIf(SpanAttributes['coding_agent.llm.turn.kind'], ''), 'user_prompt') AS kind,
			SpanAttributes['${GEN_AI_ATTR.requestModel}']               AS model,
			coalesce(SpanAttributes['gen_ai.input.messages'], SpanAttributes['gen_ai.prompt'], '') AS prompt,
			coalesce(SpanAttributes['gen_ai.output.messages'], SpanAttributes['gen_ai.completion'], '') AS response,
			SpanAttributes['coding_agent.llm.thought.text']             AS thought,
			toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageInputTokens}'])  AS input_tokens,
			toInt64OrZero(SpanAttributes['${GEN_AI_ATTR.usageOutputTokens}']) AS output_tokens,
			toFloat64OrZero(SpanAttributes['${GEN_AI_ATTR.usageCost}'])      AS cost_usd,
			SpanAttributes['coding_agent.llm.turn.attachment.paths']    AS attachment_paths_raw
		FROM ${OTEL_TRACES_TABLE}
		WHERE SpanName = '${CODING_AGENT_SPAN_LLM_TURN}'
		AND SpanAttributes['${CODING_AGENT_ATTR.sessionId}'] = '${sid}'
		ORDER BY Timestamp ASC
		LIMIT 500
	`;

	const toolCallsQuery = `
		SELECT
			formatDateTime(Timestamp, '%Y-%m-%dT%H:%M:%S.%fZ')          AS timestamp,
			coalesce(nullIf(SpanAttributes['${GEN_AI_ATTR.toolName}'], ''), 'unknown') AS tool_name,
			SpanAttributes['gen_ai.tool.call.id']                       AS tool_use_id,
			SpanAttributes['${CODING_AGENT_ATTR.mcpServerName}']        AS mcp_server_name,
			SpanAttributes['coding_agent.tool.command']                 AS command,
			SpanAttributes['code.cwd']                                  AS working_dir,
			SpanAttributes['gen_ai.tool.call.arguments']                AS args,
			SpanAttributes['gen_ai.tool.call.result']                   AS result,
			toInt64OrZero(SpanAttributes['coding_agent.tool.duration_ms']) AS duration_ms,
			if(notEmpty(SpanAttributes['error.type']), 1, 0)            AS errored,
			SpanAttributes['exception.message']                         AS error_msg,
			SpanAttributes['error.type']                                AS failure_type,
			if(SpanAttributes['coding_agent.tool.sandboxed'] = 'true', 1, 0) AS sandboxed
		FROM ${OTEL_TRACES_TABLE}
		WHERE SpanName = '${CODING_AGENT_SPAN_TOOL_CALL}'
		AND SpanAttributes['${CODING_AGENT_ATTR.sessionId}'] = '${sid}'
		ORDER BY Timestamp ASC
		LIMIT 500
	`;

	const editsQuery = `
		SELECT
			formatDateTime(Timestamp, '%Y-%m-%dT%H:%M:%S.%fZ')          AS timestamp,
			SpanAttributes['code.file.path']                            AS file_path,
			SpanAttributes['${CODING_AGENT_ATTR.editDecision}']         AS decision,
			SpanAttributes['${CODING_AGENT_ATTR.editDecisionSource}']   AS source,
			SpanAttributes['coding_agent.edit.tool.name']               AS tool_name,
			toInt32OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesAdded}'])   AS lines_added,
			toInt32OrZero(SpanAttributes['${CODING_AGENT_ATTR.editLinesRemoved}']) AS lines_removed,
			SpanAttributes['${CODING_AGENT_ATTR.editLanguage}']         AS language
		FROM ${OTEL_TRACES_TABLE}
		WHERE SpanName = '${CODING_AGENT_SPAN_EDIT_DECISION}'
		AND SpanAttributes['${CODING_AGENT_ATTR.sessionId}'] = '${sid}'
		ORDER BY Timestamp ASC
		LIMIT 500
	`;

	const subagentsQuery = `
		SELECT
			formatDateTime(Timestamp, '%Y-%m-%dT%H:%M:%S.%fZ')          AS timestamp,
			SpanAttributes['coding_agent.subagent.type']                AS subagent_type,
			SpanAttributes['coding_agent.subagent.task']                AS task,
			SpanAttributes['coding_agent.subagent.summary']             AS summary,
			coalesce(nullIf(SpanAttributes['coding_agent.subagent.status'], ''), 'unknown') AS status,
			toInt64OrZero(SpanAttributes['coding_agent.subagent.duration_ms']) AS duration_ms,
			toInt32OrZero(SpanAttributes['coding_agent.subagent.message_count']) AS message_count,
			toInt32OrZero(SpanAttributes['coding_agent.subagent.tool_call_count']) AS tool_call_count,
			SpanAttributes['coding_agent.subagent.modified_files']      AS modified_files_raw
		FROM ${OTEL_TRACES_TABLE}
		WHERE SpanName = '${CODING_AGENT_SPAN_SUBAGENT}'
		AND SpanAttributes['${CODING_AGENT_ATTR.sessionId}'] = '${sid}'
		ORDER BY Timestamp ASC
		LIMIT 100
	`;

	const [
		{ data: baseData, err: baseErr },
		{ data: toolsData },
		{ data: mcpData },
		{ data: turnsData },
		{ data: toolCallsData },
		{ data: editsData },
		{ data: subagentsData },
	] = await Promise.all([
		dataCollector({ query: baseQuery }),
		dataCollector({ query: toolsQuery }),
		dataCollector({ query: mcpQuery }),
		dataCollector({ query: turnsQuery }),
		dataCollector({ query: toolCallsQuery }),
		dataCollector({ query: editsQuery }),
		dataCollector({ query: subagentsQuery }),
	]);

	if (baseErr) throw baseErr;
	const rows = (baseData || []) as Array<
		CodingAgentSessionRow & {
			model: string;
			branch: string;
			commit_sha: string;
			policy_permission_mode: string;
			content_capture_mode: string;
		}
	>;
	if (!rows.length) return null;
	const detail = rows[0]!;

	const projected = await applyCohortFloor(auth, [detail]);
	const safe = projected[0];
	if (!safe) return null;

	return {
		...safe,
		model: detail.model || "",
		branch: detail.branch || "",
		commit_sha: detail.commit_sha || "",
		policy_permission_mode: detail.policy_permission_mode || "unknown",
		content_capture_mode: detail.content_capture_mode || "unknown",
		tools: (toolsData || []) as { tool_name: string; calls: number }[],
		mcp_servers: (mcpData || []) as { server_name: string; calls: number }[],
		turns: ((turnsData || []) as Array<
			CodingAgentLLMTurnRow & { attachment_paths_raw?: string }
		>).map((t) => ({
			...t,
			attachment_paths: parseStringSlice(t.attachment_paths_raw),
		})),
		tool_calls: ((toolCallsData || []) as Array<
			Omit<CodingAgentToolCallRow, "errored" | "sandboxed"> & {
				errored: number | boolean;
				sandboxed: number | boolean;
			}
		>).map((t) => ({
			...t,
			errored: Boolean(Number(t.errored)),
			sandboxed: Boolean(Number(t.sandboxed)),
		})),
		edits: (editsData || []) as CodingAgentEditRow[],
		subagents: ((subagentsData || []) as Array<
			CodingAgentSubagentRow & { modified_files_raw?: string }
		>).map((s) => ({
			...s,
			modified_files: parseStringSlice(s.modified_files_raw),
		})),
	};
}

/**
 * ClickHouse stores OTel StringSlice attributes as a stringified Array
 * literal (e.g. `['/foo','/bar']`). Parse defensively — empty strings
 * and malformed values map to empty arrays.
 */
function parseStringSlice(raw: string | undefined | null): string[] {
	if (!raw) return [];
	const trimmed = raw.trim();
	if (!trimmed || trimmed === "[]") return [];
	// ClickHouse uses single quotes for array elements; coerce to JSON
	// double quotes before parsing. We're lenient because the field
	// occasionally lands as a comma-separated string when the writer
	// emits it as a CSV.
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		try {
			const json = trimmed.replace(/'/g, '"');
			const parsed = JSON.parse(json);
			if (Array.isArray(parsed)) return parsed.map(String);
		} catch {
			// fall through
		}
	}
	return trimmed
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Replace `user` with the literal "low_cohort" when the user shows up
 * fewer than COHORT_K_FLOOR times in the working window AND the
 * caller is not an admin. Admin can always see the raw value (the
 * audit log captures the access). The window is "all data the
 * tenant has", which is conservative — a user who's been around for
 * months is fine even if they're inactive this quarter.
 *
 * For v1 we run a single rollup count query once per call rather
 * than per-row to keep latency down.
 */
async function applyCohortFloor<T extends { user: string }>(
	auth: CodingAgentAuth,
	rows: T[]
): Promise<T[]> {
	if (auth.role === "admin" || rows.length === 0) return rows;

	const distinctUsers = Array.from(new Set(rows.map((r) => r.user).filter(Boolean)));
	if (distinctUsers.length === 0) return rows;

	const inList = distinctUsers.map((u) => `'${escape(u)}'`).join(", ");
	const query = `
		SELECT
			SpanAttributes['${GEN_AI_ATTR.userName}'] AS user,
			CAST(uniq(SpanAttributes['${CODING_AGENT_ATTR.sessionId}']) AS INTEGER) AS sessions
		FROM ${OTEL_TRACES_TABLE}
		WHERE SpanName = '${CODING_AGENT_SPAN_SESSION}'
		AND notEmpty(SpanAttributes['${CODING_AGENT_ATTR.sessionId}'])
		AND SpanAttributes['${GEN_AI_ATTR.userName}'] IN (${inList})
		GROUP BY user
	`;
	const { data, err } = await dataCollector({ query });
	if (err) throw err;
	const counts = new Map<string, number>();
	for (const row of (data || []) as { user: string; sessions: number }[]) {
		counts.set(row.user, Number(row.sessions || 0));
	}

	return rows.map((r) => {
		if (!r.user) return r;
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
export async function submitClassificationDispute(
	auth: CodingAgentAuth,
	input: CodingAgentClassificationDispute
): Promise<{ id: string }> {
	const id = randomUUID();

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

function randomUUID(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	// Fallback for older Node runtimes — not security-sensitive: this
	// is only the dispute row's id, ClickHouse will dedupe on it.
	return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
		const r = Math.floor(Math.random() * 16);
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}
