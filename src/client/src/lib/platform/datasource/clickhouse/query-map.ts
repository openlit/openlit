/**
 * Map the vendor-agnostic `OpenLITQuery` onto the existing ClickHouse
 * `MetricParams` shape so the ClickHouse adapter can delegate to the
 * already-tested query builders (getRequests, getLogs, getMetrics, ...).
 */

import type { MetricParams, TimeLimit } from "@/lib/platform/common";
import type { OpenLITQuery } from "../types";

/** Build a `TimeLimit` from an OpenLITQuery time range. */
export function toTimeLimit(query: OpenLITQuery): TimeLimit {
	return {
		start: query.timeRange.start,
		end: query.timeRange.end,
		type: "CUSTOM",
	};
}

/**
 * Extract a status-code filter (if present) into the `statusCode` array the
 * builders understand.
 */
function extractStatusCodes(query: OpenLITQuery): string[] | undefined {
	const codes = (query.filters || [])
		.filter((f) => f.target === "status")
		.flatMap((f) => (Array.isArray(f.value) ? f.value : [f.value]))
		.filter((v): v is string => typeof v === "string");
	return codes.length ? codes : undefined;
}

/** Build a `MetricParams` from an OpenLITQuery. */
export function toMetricParams(query: OpenLITQuery): MetricParams {
	const sort = query.sort?.[0];
	return {
		timeLimit: toTimeLimit(query),
		limit: query.limit,
		offset: query.offset,
		statusCode: extractStatusCodes(query),
		sorting: sort
			? { type: sort.field, direction: sort.direction }
			: undefined,
	} as MetricParams;
}
