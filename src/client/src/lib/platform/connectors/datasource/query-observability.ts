/**
 * Lightweight query observability for external telemetry reads.
 *
 * Emits a single structured debug line per adapter read (source type, signal,
 * mode, latency, rows, freshness, degraded caps) so operators can reason about
 * quota/latency without a heavy tracing dependency. Built-in ClickHouse reads
 * are skipped to avoid noise. Controlled by `OPENLIT_QUERY_OBSERVABILITY`.
 */

import type { DataFrameMeta } from "./types";

export interface QueryObservabilityContext {
	sourceType: string;
	signal: string;
	mode?: string;
	isBuiltIn?: boolean;
}

function enabled(): boolean {
	// Default on outside production so LGTM smoke tests surface query stats;
	// opt-in in production via the env flag.
	const flag = process.env.OPENLIT_QUERY_OBSERVABILITY;
	if (flag === "1" || flag === "true") return true;
	if (flag === "0" || flag === "false") return false;
	return process.env.NODE_ENV !== "production";
}

/** Log a one-line summary of an adapter query result. Never throws. */
export function logQueryObservability(
	ctx: QueryObservabilityContext,
	meta: DataFrameMeta | undefined,
	rowCount: number
): void {
	try {
		if (ctx.isBuiltIn || !enabled()) return;
		const parts = [
			`source=${ctx.sourceType}`,
			`signal=${ctx.signal}`,
			ctx.mode ? `mode=${ctx.mode}` : "",
			`rows=${rowCount}`,
			meta?.latencyMs !== undefined ? `latencyMs=${meta.latencyMs}` : "",
			meta?.rowsScanned !== undefined ? `scanned=${meta.rowsScanned}` : "",
			meta?.freshness ? `freshness=${meta.freshness}` : "",
			meta?.truncated ? "truncated=1" : "",
			meta?.degraded?.length ? `degraded=${meta.degraded.join(",")}` : "",
		].filter(Boolean);
		// eslint-disable-next-line no-console
		console.debug(`[telemetry-query] ${parts.join(" ")}`);
	} catch {
		// Observability must never affect the read path.
	}
}
