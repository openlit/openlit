/**
 * POST /api/coding-agents/sessions/summary
 *
 * Time-bucketed roll-up consumed by `<SignalSummary>` (the histogram
 * above the `<ObservabilitySignalList>`). Mirrors the shape returned by
 * `/api/telemetry/summary/traces` so the bar chart renders without any
 * client-side branching: `{ bucket, buckets: [{label, count}], total, peak }`.
 *
 * Auth flows through `requireCodingAgentAuth` so org/db scoping stays
 * consistent with the list route.
 */

import {
	requireCodingAgentAuth,
	CodingAgentUnauthorizedError,
} from "@/lib/platform/coding-agents/auth";
import { dataCollector } from "@/lib/platform/common";
import {
	CODING_AGENT_ATTR,
	CODING_AGENT_SPAN_NAMES,
	GEN_AI_ATTR,
	OTEL_TRACES_TABLE,
} from "@/lib/platform/coding-agents/table-details";

export const dynamic = "force-dynamic";

interface SummaryBody {
	timeLimit?: { start?: string | Date; end?: string | Date };
	runFilters?: Record<string, unknown>;
}

function escape(value: string) {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function asString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function asDate(value: unknown): Date | null {
	if (!value) return null;
	const date = new Date(value as string | number | Date);
	return Number.isNaN(date.getTime()) ? null : date;
}

function pickBucket(start: Date | null, end: Date | null) {
	const now = end ?? new Date();
	const earlier = start ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const days = Math.max(1, (now.getTime() - earlier.getTime()) / 86400000);
	if (days <= 2) return { bucket: "hour", label: "%m/%d %H:00" };
	if (days <= 45) return { bucket: "day", label: "%Y/%m/%d" };
	if (days <= 370) return { bucket: "week", label: "%Y/%m/%d" };
	return { bucket: "month", label: "%Y/%m" };
}

export async function POST(request: Request) {
	try {
		await requireCodingAgentAuth();
	} catch (err) {
		if (err instanceof CodingAgentUnauthorizedError) {
			return Response.json({ error: err.message }, { status: 401 });
		}
		throw err;
	}

	let body: SummaryBody = {};
	try {
		body = (await request.json()) as SummaryBody;
	} catch {
		// empty body is acceptable — bucket the default 24h window.
	}

	// Default analysis window — match list/users routes. See B1.
	const DEFAULT_WINDOW_HOURS = 24;
	const start =
		asDate(body.timeLimit?.start) ??
		new Date(Date.now() - DEFAULT_WINDOW_HOURS * 60 * 60 * 1000);
	const end = asDate(body.timeLimit?.end);
	const { bucket, label } = pickBucket(start, end);
	const runFilters = (body.runFilters || {}) as Record<string, unknown>;
	const vendor = asString(runFilters.vendor);
	const user = asString(runFilters.user);

	const where: string[] = [
		`SpanName IN (${CODING_AGENT_SPAN_NAMES.map((name) => `'${name}'`).join(", ")})`,
		`notEmpty(SpanAttributes['${CODING_AGENT_ATTR.sessionId}'])`,
	];
	where.push(
		`Timestamp >= parseDateTimeBestEffort('${escape(start.toISOString())}')`
	);
	if (end) {
		where.push(
			`Timestamp <= parseDateTimeBestEffort('${escape(end.toISOString())}')`
		);
	}
	if (vendor) {
		where.push(
			`coalesce(nullIf(SpanAttributes['${CODING_AGENT_ATTR.client}'], ''), SpanAttributes['${GEN_AI_ATTR.agentName}']) = '${escape(vendor)}'`
		);
	}
	if (user) {
		// E2: user identity falls through multiple keys (span attr ->
		// resource attr -> service.name) — same coalesce chain
		// listSessions uses. Filtering only on `gen_ai.user.name` here
		// would silently drop rows whose identity falls through to
		// `service.name`, leaving the histogram out of sync with the
		// table.
		where.push(`(
			coalesce(
				nullIf(SpanAttributes['${GEN_AI_ATTR.userName}'], ''),
				nullIf(ResourceAttributes['${GEN_AI_ATTR.userName}'], ''),
				ResourceAttributes['service.name']
			) = '${escape(user)}'
		)`);
	}

	// `count(distinct chat_id)` per time bucket gives us the number
	// of chat threads started in that window — same rollup the
	// Sessions list uses (parent_id wins over session_id) so the
	// histogram column and table row count line up.
	const query = `
		SELECT
			formatDateTime(DATE_TRUNC('${bucket}', Timestamp), '${label}') AS label,
			toInt64(uniqExact(
				coalesce(
					nullIf(ResourceAttributes['${CODING_AGENT_ATTR.agentParentId}'], ''),
					nullIf(SpanAttributes['${CODING_AGENT_ATTR.agentParentId}'], ''),
					SpanAttributes['${CODING_AGENT_ATTR.sessionId}']
				)
			)) AS count
		FROM ${OTEL_TRACES_TABLE}
		WHERE ${where.join(" AND ")}
		GROUP BY label
		ORDER BY min(Timestamp)
	`;

	const { data, err } = await dataCollector({ query });
	if (err) {
		console.error("coding_agent.sessions.summary_failed", err);
		return Response.json({ error: "Internal error" }, { status: 500 });
	}
	const buckets = ((data as Array<{ label: string; count: number | string }>) || [])
		.map((row) => ({ label: row.label, count: Number(row.count || 0) }));
	const total = buckets.reduce((sum, row) => sum + row.count, 0);
	const peak = buckets.reduce((max, row) => Math.max(max, row.count), 0);

	return Response.json({ bucket, buckets, total, peak });
}
