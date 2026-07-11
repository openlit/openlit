/**
 * Decide when L2 app-store rollups are safe to use.
 *
 * Multi-dimensional rollups carry service/environment, so scoped agent and
 * telemetry KPI reads may prefer L2. Version-hash filters are still not in
 * the rollup key — those fall back to L1.
 */

import type { MetricParams } from "@/lib/platform/common";
import type { OpenLITQuery } from "@/lib/platform/datasource/types";

function hasVersionScope(cfg: Record<string, unknown> | undefined): boolean {
	if (!cfg) return false;
	const version = cfg.versionFilter as { versionHash?: string } | undefined;
	return !!version?.versionHash;
}

/** True when QueryPlanner may prefer L2 rollups for this dashboard filter. */
export function shouldPreferRollup(params: MetricParams): boolean {
	return !hasVersionScope(
		(params.selectedConfig || {}) as Record<string, unknown>
	);
}

/** True when an OpenLITQuery already carries service/env/version filters. */
export function queryHasScopeFilters(query: OpenLITQuery): boolean {
	return (query.filters || []).some((f) => {
		if (f.target !== "attribute" || !f.key) return false;
		return (
			f.key === "service.name" ||
			f.key === "deployment.environment" ||
			f.key === "openlit.agent.version_hash"
		);
	});
}
