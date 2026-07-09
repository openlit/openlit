/**
 * Cost overlay: read-time cost application for immutable telemetry sources.
 *
 * STATUS: library + migration exist; not yet applied on external adapter read
 * paths. Keep until pricing for external sources is wired — do not treat as a
 * shipped product feature.
 *
 * ClickHouse-native telemetry backfills cost in place (see `pricing/index.ts`).
 * External sources are read-only, so recomputed per-span cost will live in
 * `openlit_cost_overlay` and be applied at read time when that path lands.
 */

import { dataCollector } from "@/lib/platform/common";
import type { NormalizedSpan } from "@/lib/platform/datasource/types";

export const OPENLIT_COST_OVERLAY_TABLE = "openlit_cost_overlay";

export interface CostOverlayEntry {
	spanId: string;
	cost: number;
	model?: string;
}

function escapeCH(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Persist recomputed costs for a source. Uses the ReplacingMergeTree version
 * column (`updated_at`) so re-computes overwrite prior rows on merge.
 */
export async function upsertCostOverlays(
	sourceId: string,
	entries: CostOverlayEntry[],
	dbConfigId?: string
): Promise<{ err?: unknown }> {
	if (!sourceId || entries.length === 0) return {};
	const values = entries
		.filter((e) => e.spanId)
		.map((e) => ({
			source_id: sourceId,
			span_id: e.spanId,
			cost_usd: Number.isFinite(e.cost) ? e.cost : 0,
			model: e.model || "",
		}));
	if (values.length === 0) return {};
	const { err } = await dataCollector(
		{ table: OPENLIT_COST_OVERLAY_TABLE, values },
		"insert",
		dbConfigId
	);
	return { err };
}

/**
 * Fetch the cost overlay for a set of spans. Returns a `spanId -> cost` map.
 * Uses FINAL so only the latest (ReplacingMergeTree) row per span is read.
 */
export async function getCostOverlay(
	sourceId: string,
	spanIds: string[],
	dbConfigId?: string
): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	const ids = Array.from(new Set(spanIds.filter(Boolean)));
	if (!sourceId || ids.length === 0) return out;
	const inList = ids.map((id) => `'${escapeCH(id)}'`).join(", ");
	const query = `SELECT span_id, cost_usd
		FROM ${OPENLIT_COST_OVERLAY_TABLE} FINAL
		WHERE source_id = '${escapeCH(sourceId)}' AND span_id IN (${inList})`;
	const { data } = await dataCollector({ query }, "query", dbConfigId);
	for (const row of (data as { span_id?: string; cost_usd?: number }[]) || []) {
		if (row.span_id) out.set(row.span_id, Number(row.cost_usd) || 0);
	}
	return out;
}

/**
 * Apply an overlay map to normalized spans. Returns new span objects with
 * `cost` (and `SpanAttributes['gen_ai.usage.cost']`) set from the overlay when
 * present; spans without an overlay entry are returned unchanged.
 */
export function applyCostOverlayToSpans(
	spans: NormalizedSpan[],
	overlay: Map<string, number>
): NormalizedSpan[] {
	if (overlay.size === 0) return spans;
	return spans.map((span) => {
		if (!overlay.has(span.spanId)) return span;
		const cost = overlay.get(span.spanId)!;
		return {
			...span,
			cost,
			spanAttributes: {
				...span.spanAttributes,
				"gen_ai.usage.cost": String(cost),
			},
		};
	});
}

/**
 * Convenience: fetch + apply the overlay for a source in one call.
 */
export async function withCostOverlay(
	sourceId: string,
	spans: NormalizedSpan[],
	dbConfigId?: string
): Promise<NormalizedSpan[]> {
	const overlay = await getCostOverlay(
		sourceId,
		spans.map((s) => s.spanId),
		dbConfigId
	);
	return applyCostOverlayToSpans(spans, overlay);
}
