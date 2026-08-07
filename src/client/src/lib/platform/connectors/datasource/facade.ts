/**
 * Shared helpers for the per-signal read facades (traces / logs / metrics).
 *
 * Every facade resolves the currently bound source here and invokes the same
 * DataSourceAdapter contract. The built-in ClickHouse adapter is not a bypass:
 * its reads ultimately enter ClickHouse through `dataCollector` -> OpenPlait.
 * Results are denormalized back to the rows the existing UI consumes.
 *
 * FOLLOW-UP (columnar end-to-end): adapters already produce the normalized
 * columnar contract (`DataFrame` / `NormalizedSpan|Log|MetricPoint`), but these
 * facades denormalize back to ClickHouse-shaped rows so the existing UI tables
 * keep working unchanged. That denormalization is the one place a new adapter
 * inherits CH-shaped assumptions. When the UI tables are migrated to consume
 * `DataFrame` directly, drop the `denormalize*` calls here and pass frames
 * through — no adapter changes required. Tracked as a known follow-up; not a
 * blocker for adding new datasources (which only touch adapter + descriptor).
 */

import { AdapterError } from "@openplait/adapter-sdk";
import type { DataSourceAdapter, Signal } from "./types";
import { UnsupportedCapabilityError } from "./types";
import getMessage from "@/constants/messages";

export interface SignalReadContext {
	adapter: DataSourceAdapter;
	descriptor: {
		id: string;
		type: string;
		isBuiltIn: boolean;
		name: string;
		dbConfigId?: string;
	};
	/** Metadata only; signal facades must not branch around the adapter on it. */
	isBuiltIn: boolean;
}

/** Resolve the adapter + descriptor for a signal read. */
export async function resolveSignalReadContext(
	signal: Signal,
	options: { sourceId?: string; environment?: string; dbConfigId?: string; projectId?: string | null } = {}
): Promise<SignalReadContext> {
	const { getTelemetryAdapter, resolveTelemetrySourceDescriptor } =
		await import("@/lib/telemetry-source");
	const descriptor = await resolveTelemetrySourceDescriptor({ signal, ...options });
	const adapter = await getTelemetryAdapter({ signal, ...options, descriptor });
	return {
		adapter,
		descriptor,
		isBuiltIn: descriptor.isBuiltIn || descriptor.type === "clickhouse",
	};
}

/** Prefer a concise upstream explanation when OpenPlait only reports HTTP status. */
function adapterUpstreamMessage(error: AdapterError): string | undefined {
	const body = error.details?.body;
	if (typeof body !== "string") return undefined;
	const cleaned = body
		.replace(/^Data source responded \d+:\s*/i, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!cleaned) return undefined;
	// Keep the first sentence/line — enough for Loki/Tempo limit messages.
	return cleaned.split(/(?<=\.)\s|\n/)[0]?.slice(0, 300) || undefined;
}

/** Normalize any thrown value into a user-facing error string. */
export function facadeErrorMessage(err: unknown): string {
	if (err instanceof UnsupportedCapabilityError) return err.message;
	if (err instanceof AdapterError) {
		const upstream = adapterUpstreamMessage(err);
		if (upstream && /returned HTTP \d+/i.test(err.message)) {
			return `${err.message.replace(/\.$/, "")}: ${upstream}`;
		}
		return err.message;
	}
	if (err instanceof Error) return err.message;
	return typeof err === "string" ? err : getMessage().WIDGET_RUN_FAILED;
}
