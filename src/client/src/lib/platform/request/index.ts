import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "../common";
import {
	getTraceMappingKeyFullPath,
	buildHierarchy,
} from "@/helpers/server/trace";
import { SYNTHETIC_SPAN_ID_PREFIX } from "@/helpers/client/trace";
import { CODING_AGENT_ATTR } from "@/lib/platform/coding-agents/table-details";
import {
	dateTruncGroupingLogic,
	getFilterPreviousParams,
	getFilterWhereCondition,
} from "@/helpers/server/platform";

const PREDEFINED_GROUP_BY: Record<string, string> = {
	model: `SpanAttributes['gen_ai.request.model']`,
	provider: `SpanAttributes['gen_ai.system']`,
	spanName: `SpanName`,
	applicationName: `ResourceAttributes['service.name']`,
};

const ALLOWED_FIELD_GROUP_BY = new Set([
	"TraceId",
	"ParentSpanId",
	"TraceState",
	"SpanId",
	"SpanName",
	"SpanKind",
	"ServiceName",
	"ScopeName",
	"ScopeVersion",
	"Timestamp",
	"Duration",
	"StatusCode",
	"StatusMessage",
]);

function escapeClickHouseString(value: string) {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function getGroupByExpression(groupBy: string): string | null {
	if (groupBy in PREDEFINED_GROUP_BY) return PREDEFINED_GROUP_BY[groupBy];
	const sep = groupBy.indexOf(":");
	if (sep === -1) {
		const sanitized = escapeClickHouseString(groupBy).trim();
		if (!sanitized) return null;
		return `SpanAttributes['${sanitized}']`;
	}
	const attrType = groupBy.slice(0, sep);
	const key = escapeClickHouseString(groupBy.slice(sep + 1)).trim();
	if (!key) return null;
	if (attrType === "ResourceAttributes") return `ResourceAttributes['${key}']`;
	if (attrType === "Field") {
		const field = key.replace(/[^A-Za-z0-9_.]/g, "");
		if (!field || !ALLOWED_FIELD_GROUP_BY.has(field)) return null;
		return field;
	}
	if (attrType === "SpanAttributes") return `SpanAttributes['${key}']`;
	return `SpanAttributes['${key}']`;
}

export async function getRequestPerTime(params: MetricParams) {
	const { start, end } = params.timeLimit;
	const dateTrunc = dateTruncGroupingLogic(end as Date, start as Date);

	const query = `
		SELECT
			CAST(COUNT(*) AS INTEGER) AS total,
			formatDateTime(DATE_TRUNC('${dateTrunc}', Timestamp), '%Y/%m/%d %R') AS request_time
		FROM
			${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition({ ...params, operationType: "llm" }, true)}
		GROUP BY
			request_time
		ORDER BY
			request_time;
		`;

	return dataCollector({ query });
}

export async function getTotalRequests(params: MetricParams) {
	const commonQuery = (parameters: MetricParams) => `
		SELECT
			COUNT(*) AS total_requests,
			'${params.timeLimit.start}' as start_date
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition(parameters, true)}	
	`;

	const previousWhereParams = getFilterPreviousParams(params);
	const query = `
		SELECT
			CAST(current_data.total_requests AS INTEGER) AS total_requests,
			CAST(previous_day.total_requests AS INTEGER) AS previous_total_requests
		FROM
			(
				${commonQuery(params)}
			) as current_data
			JOIN
			(
				${commonQuery(previousWhereParams)}
			) as previous_day
		ON
			current_data.start_date = previous_day.start_date;
	`;

	return dataCollector({ query });
}

export async function getAverageRequestDuration(params: MetricParams) {
	const keyPath = `${getTraceMappingKeyFullPath("requestDuration")}`;

	const commonQuery = (parameters: MetricParams) => `
		SELECT
			AVG(${keyPath}) AS average_duration,
			'${params.timeLimit.start}' as start_date
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(parameters, true)} AND isFinite(${keyPath})
	`;

	const currentWhereParams = params;
	const previousWhereParams = getFilterPreviousParams(currentWhereParams);

	const query = `
		SELECT
			CAST(current_data.average_duration AS FLOAT) AS average_duration,
			CAST(previous_day.average_duration AS FLOAT) AS previous_average_duration
		FROM
			(
				${commonQuery(currentWhereParams)}
			) as current_data
			JOIN
			(
				${commonQuery(previousWhereParams)}
			) as previous_day
		ON
			current_data.start_date = previous_day.start_date;
	`;

	return dataCollector({ query });
}

export async function getRequestsConfig(params: MetricParams) {
	const select: string[] = [];

	// Provider filter source list. Folds three attribute namespaces
	// into one flat set so the "Provider" dropdown in the filter bar
	// can act as a universal traffic-shaper:
	//   • gen_ai.system   — LLM provider on regular GenAI spans
	//   • db.system       — vector-DB provider on retrieval spans
	//   • coding_agent.client — coding-agent vendor (cursor / codex /
	//     claude_code) on every span we emit from the CLI hook. We
	//     surface it here (rather than building a separate "Vendor"
	//     filter) so operators can untick e.g. "cursor" to hide all
	//     of that vendor's telemetry from any view — the user asked
	//     for vendor visibility without a new control. The WHERE
	//     side of this fold lives in helpers/server/platform.ts.
	select.push(
		`arrayConcat(
			arrayFilter(x -> x != '', groupArray(DISTINCT SpanAttributes['${getTraceMappingKeyFullPath(
			"provider"
		)}'])),
			arrayFilter(x -> x != '', groupArray(DISTINCT SpanAttributes['${getTraceMappingKeyFullPath(
			"system"
		)}'])),
			arrayFilter(x -> x != '', groupArray(DISTINCT SpanAttributes['coding_agent.client']))
		) AS providers`
	);

	select.push(
		`CAST(MAX(toFloat64OrZero(SpanAttributes['${getTraceMappingKeyFullPath(
			"cost"
		)}'])) AS FLOAT) AS maxCost`
	);

	select.push(
		`arrayFilter(x -> x != '', ARRAY_AGG(DISTINCT SpanAttributes['${getTraceMappingKeyFullPath(
			"model"
		)}'])) AS models`
	);

	select.push(
		`arrayFilter(x -> x != '', ARRAY_AGG(DISTINCT SpanAttributes['${getTraceMappingKeyFullPath(
			"type"
		)}'])) AS traceTypes`
	);

	select.push(`CAST(COUNT(*) AS INTEGER) AS totalRows`);

	select.push(
		`arrayFilter(x -> x != '', ARRAY_AGG(DISTINCT ResourceAttributes['${getTraceMappingKeyFullPath(
			"applicationName"
		)}'])) AS applicationNames`
	);

	select.push(
		`arrayFilter(x -> x != '', ARRAY_AGG(DISTINCT SpanName)) AS spanNames`
	);

	select.push(
		// OTel-standard environment is `ResourceAttributes['deployment.environment']`.
		// The legacy `getTraceMappingKeyFullPath("environment")` returns a
		// dotted SpanAttributes path that, wrapped in `ResourceAttributes[...]`,
		// resolves to a non-existent key and silently yields no values.
		`arrayFilter(x -> x != '', ARRAY_AGG(DISTINCT ResourceAttributes['deployment.environment'])) AS environments`
	);

	const query = `SELECT ${select.join(", ")} FROM ${OTEL_TRACES_TABLE_NAME} 
			WHERE ${getFilterWhereCondition(params, true)}`;

	return dataCollector({ query });
}

export async function getRequests(params: MetricParams) {
	const { limit = 10, offset = 0 } = params;

	const countQuery = `SELECT CAST(COUNT(*) AS INTEGER) AS total	FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition(params, true)}`;

	const { data: dataTotal, err: errTotal } = await dataCollector({
		query: countQuery,
	});
	if (errTotal) {
		return {
			err: errTotal,
		};
	}

	const query = `SELECT *	FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition(params, true)}
		${params.sorting
			? params.sorting.type.includes("cost")
				? `ORDER BY toFloat64OrZero(${params.sorting.type}) ${params.sorting.direction} `
				: params.sorting.type.includes("tokens")
					? `ORDER BY toInt32OrZero(${params.sorting.type}) ${params.sorting.direction} `
					: `ORDER BY ${params.sorting.type} ${params.sorting.direction} `
			: `ORDER BY Timestamp desc `
		}
		LIMIT ${limit}
		OFFSET ${offset}`;

	const { data, err } = await dataCollector({ query });
	return {
		err,
		records: data,
		total: (dataTotal as any[])?.[0]?.total || 0,
	};
}

export async function getRequestViaSpanId(spanId: string) {
	const safeSpanId = escapeClickHouseString(String(spanId ?? ""));
	const query = `SELECT *	FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE SpanId='${safeSpanId}'`;

	const { data, err } = await dataCollector({ query });
	return {
		err,
		record: (data as unknown[])?.[0],
	};
}

export async function getRequestViaTraceId(traceId: string) {
	const safeTraceId = escapeClickHouseString(String(traceId ?? ""));
	const query = `SELECT *	FROM ${OTEL_TRACES_TABLE_NAME} WHERE ${getTraceMappingKeyFullPath(
		"id"
	)}='${safeTraceId}'`;

	const { data, err } = await dataCollector({ query });
	return {
		err,
		record: (data as unknown[])?.[0],
	};
}

export async function getHeirarchyViaSpanId(spanId: string) {
	// Step 1: resolve the source span. We need:
	//   - TraceId (the usual "show every span in the trace" path)
	//   - coding_agent.session.id (so coding-agent sessions whose CLI
	//     emitted multiple independent traces still render as one
	//     conversation)
	//   - coding_agent.agent.parent_id (resource attr, set on subagent
	//     hooks). When this is set, the chat we should display is the
	//     PARENT's chat — fold this subagent's spans into the parent
	//     trace, and union with the parent's own session_id, and with
	//     all sibling subagents.
	const safeSpanId = escapeClickHouseString(String(spanId ?? ""));
	const sourceSpanQuery = `
		SELECT
			TraceId,
			SpanAttributes['coding_agent.session.id'] AS CodingSessionId,
			coalesce(
				nullIf(ResourceAttributes['coding_agent.agent.parent_id'], ''),
				nullIf(SpanAttributes['coding_agent.agent.parent_id'], '')
			) AS CodingParentId
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE SpanId = '${safeSpanId}'
		LIMIT 1`;

	const { data: sourceData, err: sourceErr } = await dataCollector({
		query: sourceSpanQuery,
	});

	if (sourceErr || !Array.isArray(sourceData) || sourceData.length === 0) {
		return { err: "Span not found", record: {} };
	}

	const traceId = sourceData[0].TraceId as string | undefined;
	const ownSessionId = (sourceData[0].CodingSessionId || "") as string;
	const parentId = (sourceData[0].CodingParentId || "") as string;
	// The chat id we display is the parent's id when the source span
	// is a subagent's; otherwise it's the source span's own session.
	const codingSessionId = parentId || ownSessionId;
	if (!traceId && !codingSessionId) {
		return { err: "TraceId not found for span", record: {} };
	}

	// Step 2: fetch every span we care about. For coding-agent sessions
	// we union three sources:
	//   - this trace (TraceId match — same hook invocation)
	//   - all spans whose own session_id == chat id (the parent's own
	//     spans when we opened from a subagent, or any spans that
	//     share the chat id directly)
	//   - all subagent spans pointing at this chat id (resource OR
	//     span attribute parent_id match — folds subagents into the
	//     parent's chat thread regardless of which session emitted them)
	const safeTraceId = escapeClickHouseString(String(traceId ?? ""));
	const filterClause = codingSessionId
		? `(${getTraceMappingKeyFullPath(
				"id"
			)} = '${safeTraceId}' OR SpanAttributes['coding_agent.session.id'] = '${escapeClickHouseString(codingSessionId)}' OR ResourceAttributes['coding_agent.agent.parent_id'] = '${escapeClickHouseString(codingSessionId)}' OR SpanAttributes['coding_agent.agent.parent_id'] = '${escapeClickHouseString(codingSessionId)}')`
		: `${getTraceMappingKeyFullPath("id")} = '${safeTraceId}'`;

	const allSpansQuery = `
		SELECT
			${getTraceMappingKeyFullPath("id")},
			${getTraceMappingKeyFullPath("parentSpanId")},
			${getTraceMappingKeyFullPath("spanId")},
			${getTraceMappingKeyFullPath("spanName")},
			${getTraceMappingKeyFullPath("requestDuration")},
			toFloat64OrZero(SpanAttributes['${getTraceMappingKeyFullPath("cost")}']) AS Cost,
			Timestamp,
			StatusCode,
			StatusMessage,
			ServiceName,
			SpanKind,
			TraceState,
			ScopeName,
			ScopeVersion,
			SpanAttributes,
			ResourceAttributes,
			Events,
			Links
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${filterClause}
		ORDER BY Timestamp ASC
		LIMIT 5000`;

	const { data: allSpans, err: allSpansErr } = await dataCollector({
		query: allSpansQuery,
	});

	if (allSpansErr || !Array.isArray(allSpans) || allSpans.length === 0) {
		return { err: "Failed to fetch trace spans", record: {} };
	}

	// Step 3: Build the hierarchy tree in JS.
	// - For coding-agent sessions, prefer the explicit `coding_agent.session`
	//   span as the root (synthesizing one if absent), then attach every
	//   other span as a child. This works whether the CLI emitted one
	//   shared TraceId or many independent traces.
	// - For other traces, fall back to the regular ParentSpanId-based
	//   buildHierarchy.
	if (codingSessionId) {
		const heirarchy = buildCodingSessionHierarchy(
			allSpans as any[],
			codingSessionId
		);
		if (!heirarchy) {
			return { err: "Error building hierarchy", record: {} };
		}
		return { err: null, record: heirarchy };
	}

	const heirarchy = buildHierarchy(allSpans as any[]);

	if (!heirarchy) {
		return { err: "Error building hierarchy", record: {} };
	}

	return { err: null, record: heirarchy };
}

/**
 * Coding-agent sessions span ≥ 1 trace because each hook invocation
 * historically produced its own trace. The session-detail UI needs a
 * single tree, so we synthesize one:
 *   - prefer the `coding_agent.session` span as the root when present,
 *   - otherwise mint a synthetic root node carrying the session id,
 *   - attach every other span as a direct child of the root.
 *
 * We deliberately don't try to honor ParentSpanId across traces — the
 * chat view flattens the tree anyway, and the timeline / tree views
 * still get a clean chronological list.
 */
function buildCodingSessionHierarchy(spans: any[], sessionId: string) {
	if (spans.length === 0) return null;
	const sessionSpan = spans.find(
		(s) => s.SpanName === "coding_agent.session"
	);
	const earliest = spans.reduce((acc, s) => {
		const ts = s.Timestamp ? new Date(s.Timestamp).getTime() : 0;
		const accTs = acc?.Timestamp ? new Date(acc.Timestamp).getTime() : 0;
		return !acc || ts < accTs ? s : acc;
	}, undefined as any);
	// Whole-session wall-clock duration, mirroring `getCodingSessionDigest`'s
	// `greatest(reported coding_agent.session.duration_ms, max(start) - min(start))`.
	// The raw `coding_agent.session` span Duration is unreliable (frequently 0,
	// or just one hook invocation's slice), which is why the root node's time
	// didn't match the detail header's session Duration. We recompute it here so
	// the tree/timeline/graph root reflects the full session and matches the
	// header. The header itself sources its value from `sessionDigest`, so this
	// override is display-only for the hierarchy and can't regress it.
	const sessionDurationNs = (() => {
		let minTs = Number.POSITIVE_INFINITY;
		let maxTs = Number.NEGATIVE_INFINITY;
		let reportedMs = 0;
		for (const s of spans) {
			const ts = s.Timestamp ? new Date(s.Timestamp).getTime() : NaN;
			if (Number.isFinite(ts)) {
				if (ts < minTs) minTs = ts;
				if (ts > maxTs) maxTs = ts;
			}
			const reported = Number(
				s?.SpanAttributes?.[CODING_AGENT_ATTR.sessionDurationMs] || 0
			);
			if (Number.isFinite(reported) && reported > reportedMs) {
				reportedMs = reported;
			}
		}
		const wallClockMs =
			Number.isFinite(minTs) && Number.isFinite(maxTs) ? maxTs - minTs : 0;
		// ms → ns: `Duration` is nanoseconds (requestDuration offset is 1e-9).
		return Math.max(reportedMs, wallClockMs, 0) * 1e6;
	})();
	const root = sessionSpan
		? { ...sessionSpan, Duration: sessionDurationNs, children: [] as any[] }
		: {
				SpanId: `${SYNTHETIC_SPAN_ID_PREFIX}${sessionId}`,
				ParentSpanId: "",
				SpanName: "coding_agent.session",
				TraceId: earliest?.TraceId || "",
				Timestamp: earliest?.Timestamp || "",
				Duration: sessionDurationNs,
				Cost: 0,
				StatusCode: "",
				SpanAttributes: {
					"coding_agent.session.id": sessionId,
				},
				ResourceAttributes: earliest?.ResourceAttributes || {},
				children: [] as any[],
			};
	const sorted = [...spans].sort((a, b) => {
		const ta = a.Timestamp ? new Date(a.Timestamp).getTime() : 0;
		const tb = b.Timestamp ? new Date(b.Timestamp).getTime() : 0;
		return ta - tb;
	});
	for (const span of sorted) {
		if (span.SpanId === root.SpanId) continue;
		root.children.push({ ...span, children: [] });
	}
	return root;
}

export async function getRequestExist() {
	const query = `SELECT COUNT(*) AS total_requests FROM ${OTEL_TRACES_TABLE_NAME}`;
	return dataCollector({ query });
}

export async function getAttributeKeys(params: MetricParams) {
	const spanKeysQuery = `
		SELECT DISTINCT arrayJoin(mapKeys(SpanAttributes)) AS key
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(params, true)}
		ORDER BY key
		LIMIT 500
	`;

	const resourceKeysQuery = `
		SELECT DISTINCT arrayJoin(mapKeys(ResourceAttributes)) AS key
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(params, true)}
		ORDER BY key
		LIMIT 500
	`;

	const [spanResult, resourceResult] = await Promise.all([
		dataCollector({ query: spanKeysQuery }),
		dataCollector({ query: resourceKeysQuery }),
	]);

	return {
		err: spanResult.err || resourceResult.err,
		spanAttributeKeys: (spanResult.data as { key: string }[] | undefined)?.map((r) => r.key) ?? [],
		resourceAttributeKeys: (resourceResult.data as { key: string }[] | undefined)?.map((r) => r.key) ?? [],
	};
}

export async function getGroupedRequests(params: MetricParams, groupBy: string) {
	const expr = getGroupByExpression(groupBy);
	if (!expr) {
		return {
			err: "Invalid groupBy value",
			data: [],
		};
	}
	const query = `
		SELECT
			${expr} AS group_value,
			CAST(COUNT(*) AS INTEGER) AS count,
			CAST(SUM(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost'])) AS FLOAT) AS total_cost,
			CAST(SUM(toInt64OrZero(SpanAttributes['gen_ai.usage.total_tokens'])) AS INTEGER) AS total_tokens,
			CAST(AVG(Duration) * 1e-9 AS FLOAT) AS avg_duration_seconds
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(params, true)}
		GROUP BY group_value
		ORDER BY count DESC
	`;
	return dataCollector({ query });
}
