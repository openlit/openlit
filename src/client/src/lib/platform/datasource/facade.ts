/**
 * Shared helpers for the per-signal read facades (traces / logs / metrics).
 *
 * Every facade follows the same pattern: built-in ClickHouse keeps its exact
 * `lib/platform` SQL path (full filter fidelity, zero behavior change); an
 * external source resolves its adapter here and denormalizes results back to
 * the ClickHouse-shaped rows the UI already consumes. Signal resolution stays
 * behind a dynamic import so these modules never pull the Prisma/adapter graph
 * into surfaces that only need the built-in path.
 */

import type { DataSourceAdapter, Signal } from "./types";
import { UnsupportedCapabilityError } from "./types";
import getMessage from "@/constants/messages";

export interface SignalReadContext {
	adapter: DataSourceAdapter;
	descriptor: { type: string; isBuiltIn: boolean; name: string };
	/** True when the resolved source is the built-in ClickHouse store. */
	isBuiltIn: boolean;
}

/** Resolve the adapter + descriptor for a signal read. */
export async function resolveSignalReadContext(
	signal: Signal
): Promise<SignalReadContext> {
	const { getTelemetryAdapter, resolveTelemetrySourceDescriptor } =
		await import("@/lib/telemetry-source");
	const descriptor = await resolveTelemetrySourceDescriptor({ signal });
	const adapter = await getTelemetryAdapter({ signal });
	return {
		adapter,
		descriptor,
		isBuiltIn: descriptor.isBuiltIn || descriptor.type === "clickhouse",
	};
}

/** Normalize any thrown value into a user-facing error string. */
export function facadeErrorMessage(err: unknown): string {
	if (err instanceof UnsupportedCapabilityError) return err.message;
	if (err instanceof Error) return err.message;
	return typeof err === "string" ? err : getMessage().WIDGET_RUN_FAILED;
}
