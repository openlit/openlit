import type { Signal } from "@/lib/platform/connectors/datasource/types";
import { resolveSignalSource } from "@/lib/telemetry-source";

const TELEMETRY_TABLE_SIGNAL: Record<string, Signal> = {
	otel_traces: "traces",
	otel_logs: "logs",
	otel_metrics_gauge: "metrics",
	otel_metrics_sum: "metrics",
	otel_metrics_histogram: "metrics",
	otel_metrics_summary: "metrics",
	otel_metrics_exponential_histogram: "metrics",
};

export interface TelemetrySQLRoutingResult {
	allowed: boolean;
	blockedSignals: Array<{
		signal: Signal;
		sourceName: string;
		sourceType: string;
	}>;
	error?: string;
}

/** Signals whose raw OTel tables are referenced by a SQL statement. */
export function telemetrySignalsReferencedBySQL(query: string): Signal[] {
	const signals = new Set<Signal>();
	for (const [table, signal] of Object.entries(TELEMETRY_TABLE_SIGNAL)) {
		if (new RegExp(`\\b${table}\\b`, "i").test(query)) signals.add(signal);
	}
	return Array.from(signals);
}

/**
 * Prevent Otter SQL from bypassing per-signal connector routing.
 *
 * SQL executes against the ClickHouse database selected for intelligence. A
 * raw telemetry table is safe to read only when that signal is routed to the
 * exact same DatabaseConfig. Tempo (or a second ClickHouse database) must not
 * accidentally expose records from the intelligence database.
 */
export async function authorizeTelemetrySQLRouting(
	query: string,
	options: { environment?: string; databaseConfigId: string }
): Promise<TelemetrySQLRoutingResult> {
	const signals = telemetrySignalsReferencedBySQL(query);
	const resolutions = await Promise.all(
		signals.map(async (signal) => ({
			signal,
			resolution: await resolveSignalSource(signal, {
				environment: options.environment,
			}),
		}))
	);
	const blockedSignals = resolutions
		.filter(({ resolution }) => {
			const descriptor = resolution.descriptor;
			return (
				!resolution.hasSource ||
				descriptor.type !== "clickhouse" ||
				!descriptor.dbConfigId ||
				descriptor.dbConfigId !== options.databaseConfigId
			);
		})
		.map(({ signal, resolution }) => ({
			signal,
			sourceName: resolution.hasSource
				? resolution.descriptor.name
				: "no configured source",
			sourceType: resolution.hasSource
				? resolution.descriptor.type
				: "none",
		}));

	if (!blockedSignals.length) return { allowed: true, blockedSignals: [] };
	const routes = blockedSignals
		.map(
			({ signal, sourceName, sourceType }) =>
				`${signal} -> ${sourceName} (${sourceType})`
		)
		.join(", ");
	return {
		allowed: false,
		blockedSignals,
		error: `ClickHouse telemetry query blocked by signal routing: ${routes}. Use connector-routed telemetry instead.`,
	};
}
