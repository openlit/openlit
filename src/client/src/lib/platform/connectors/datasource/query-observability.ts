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

/** Strip CR/LF so log lines cannot be forged via user fields (CodeQL js/log-injection). */
function sanitizeLogToken(value: unknown, max = 64): string {
	return String(value ?? "")
		.replace(/\n|\r/g, "")
		.slice(0, max);
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
			`source=${sanitizeLogToken(ctx.sourceType)}`,
			`signal=${sanitizeLogToken(ctx.signal)}`,
			ctx.mode ? `mode=${sanitizeLogToken(ctx.mode)}` : "",
			`rows=${Number(rowCount) || 0}`,
			meta?.latencyMs !== undefined ? `latencyMs=${Number(meta.latencyMs) || 0}` : "",
			meta?.rowsScanned !== undefined ? `scanned=${Number(meta.rowsScanned) || 0}` : "",
			meta?.freshness ? `freshness=${sanitizeLogToken(meta.freshness)}` : "",
			meta?.truncated ? "truncated=1" : "",
			meta?.degraded?.length
				? `degraded=${sanitizeLogToken(meta.degraded.join(","), 128)}`
				: "",
		].filter(Boolean);
		// eslint-disable-next-line no-console
		console.debug(`[telemetry-query] ${parts.join(" ")}`);
	} catch {
		// Observability must never affect the read path.
	}
}
