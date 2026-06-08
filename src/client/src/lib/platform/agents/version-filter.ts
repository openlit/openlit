/**
 * Hybrid version-hash filtering.
 *
 * The agent detail page scopes every chart/widget to a single agent version.
 * Two sources of truth need to be combined:
 *
 *  1) SDK-stamped: spans emitted by SDKs that auto-emit
 *     `openlit.agent.version_hash` (see `compute_agent_version_hash` /
 *     `OpenLitHelper.computeAgentVersionHash` in the SDKs).
 *
 *  2) Historical / unstamped: spans that pre-date the SDK change. We fall
 *     back to the version's `[first_seen, last_seen]` window from
 *     `openlit_agent_versions` so those spans still resolve to a version.
 *
 * `getVersionWindow()` resolves both pieces from ClickHouse and
 * `buildVersionWhereClause()` produces the SQL fragment used by
 * `getFilterWhereCondition` and the requests query builder.
 */
import {
	dataCollector,
	OTEL_TRACES_TABLE_NAME,
} from "@/lib/platform/common";
import type { VersionFilter } from "@/types/platform";
import { swr, POLICY_VERSIONS } from "./cache";
import { agentsLogger } from "./logger";
import { getVersion } from "./snapshot";
import { getAgent } from "./index";
// Re-export the pure SQL builder so existing callers that import it from
// `./version-filter` keep working. The actual implementation lives in
// `version-where.ts` (zero side-effect imports) so leaf consumers don't
// have to drag in the DB / next-auth chain. See the comment in
// `version-where.ts` for the full rationale.
export { buildVersionWhereClause } from "./version-where";
import { escapeClickHouseString } from "@/lib/clickhouse-escape";

const escape = escapeClickHouseString;

function toClickHouseDateTime(value: string | Date): string {
	if (typeof value === "string") {
		const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
		if (m) return `${m[1]} ${m[2]}`;
	}
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime())
		? new Date().toISOString().slice(0, 19).replace("T", " ")
		: d.toISOString().slice(0, 19).replace("T", " ");
}

interface AttributeProbeParams {
	serviceName: string;
	environment: string;
	versionHash: string;
	firstSeen: string;
	lastSeen: string;
	dbConfigId?: string;
}

/**
 * Probe whether the version's traces carry the
 * `openlit.agent.version_hash` attribute. Scoped by `ServiceName` and
 * environment so we only scan the relevant slice of `otel_traces` — without
 * those predicates this was a worst-case full-table scan on every cold
 * cache miss.
 *
 * We use `SELECT 1 … LIMIT 1` rather than `count() … LIMIT 1` because
 * `count()` aggregates all matching rows even with a row limit; the explicit
 * `LIMIT 1` on the projection lets ClickHouse short-circuit as soon as it
 * finds one stamped span.
 */
async function probeAttributeStamping(
	params: AttributeProbeParams
): Promise<boolean> {
	const first = toClickHouseDateTime(params.firstSeen);
	const last = toClickHouseDateTime(params.lastSeen);
	const env = params.environment || "default";
	const envPredicate =
		env === "default"
			? `(ResourceAttributes['deployment.environment'] = 'default' OR ResourceAttributes['deployment.environment'] = '')`
			: `ResourceAttributes['deployment.environment'] = '${escape(env)}'`;
	const query = `
		SELECT 1 AS stamped
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ServiceName = '${escape(params.serviceName)}'
			AND ${envPredicate}
			AND SpanAttributes['openlit.agent.version_hash'] = '${escape(params.versionHash)}'
			AND Timestamp BETWEEN parseDateTimeBestEffort('${first}') AND parseDateTimeBestEffort('${last}')
		LIMIT 1
	`;
	const res = await dataCollector({ query }, "query", params.dbConfigId);
	if (res.err) {
		agentsLogger.error("probe_attribute_stamping_failed", {
			err: res.err,
			serviceName: params.serviceName,
			versionHash: params.versionHash,
		});
		return false;
	}
	const rows = (res.data as Array<{ stamped: number }>) || [];
	return rows.length > 0;
}

/**
 * Resolve a version window: pulls `[first_seen, last_seen]` and the version
 * hash from `openlit_agent_versions`, then probes `otel_traces` (scoped to
 * the owning service + environment) to find out whether any span in the
 * window actually carries the `openlit.agent.version_hash` attribute.
 * SWR-cached because both pieces are stable per version.
 */
export async function getVersionWindow(
	agentKey: string,
	versionHash: string,
	dbConfigId?: string
): Promise<VersionFilter | null> {
	const key = `version-window:${agentKey}:${versionHash}:${dbConfigId || "default"}`;
	return swr(key, POLICY_VERSIONS, async () => {
		const [version, agent] = await Promise.all([
			getVersion(agentKey, versionHash, dbConfigId),
			getAgent({ agentKey, dbConfigId }),
		]);
		if (!version) return null;
		const hasAttributeSpans = agent
			? await probeAttributeStamping({
					serviceName: agent.service_name,
					environment: agent.environment,
					versionHash,
					firstSeen: version.first_seen,
					lastSeen: version.last_seen,
					dbConfigId,
				})
			: false; // No service scope -> refuse to probe rather than scan everything.
		return {
			versionHash: version.version_hash,
			firstSeen: version.first_seen,
			lastSeen: version.last_seen,
			hasAttributeSpans,
		};
	});
}

