import { dateTruncGroupingLogic } from "@/helpers/server/platform";
import type { DataFrame, DataSourceAdapter, OpenLITQuery } from "./types";
import { UnsupportedCapabilityError } from "./types";
import {
	computeAggregateSpansL1,
	computeDistinctValuesL1,
	computeSpanTimeSeriesL1,
} from "./l1-compute";

export type QueryTier = "native" | "sample" | "rollup";
export type QueryFreshness = "live" | "sampled" | "accelerated";

/** Map a time window to an OpenLITQuery interval via dateTruncGroupingLogic. */
export function intervalFromTimeRange(start: Date, end: Date): string {
	const trunc = dateTruncGroupingLogic(end, start);
	if (trunc === "hour") return "1h";
	if (trunc === "month") return "1M";
	return "1d";
}

function ensureMeta(
	frame: DataFrame,
	opts: { degraded?: string; freshness?: QueryFreshness }
): DataFrame {
	const degraded = new Set(frame.meta?.degraded || []);
	if (opts.degraded) degraded.add(opts.degraded);
	return {
		...frame,
		meta: {
			...frame.meta,
			degraded: Array.from(degraded),
			freshness: opts.freshness || frame.meta?.freshness,
		},
	};
}

function hasServerAggregation(adapter: DataSourceAdapter): boolean {
	try {
		return !!adapter.capabilities()?.serverAggregation;
	} catch {
		return false;
	}
}

async function tryRollup(
	query: OpenLITQuery,
	opts?: {
		preferRollup?: boolean;
		readRollup?: (q: OpenLITQuery) => Promise<DataFrame | null>;
	}
): Promise<DataFrame | null> {
	if (!opts?.preferRollup || !opts.readRollup) return null;
	try {
		const frame = await opts.readRollup(query);
		if (!frame) return null;
		return ensureMeta(frame, {
			degraded: "rollup",
			freshness: "accelerated",
		});
	} catch {
		return null;
	}
}

/**
 * Plan aggregateSpans: L0 native (when available) → L2 rollup → L1 sample.
 */
export async function planAndAggregateSpans(
	adapter: DataSourceAdapter,
	query: OpenLITQuery,
	opts?: {
		preferRollup?: boolean;
		readRollup?: (q: OpenLITQuery) => Promise<DataFrame | null>;
	}
): Promise<DataFrame> {
	if (hasServerAggregation(adapter)) {
		return ensureMeta(await adapter.aggregateSpans(query), {
			freshness: "live",
		});
	}

	const rollup = await tryRollup(query, opts);
	if (rollup) return rollup;

	try {
		return ensureMeta(await adapter.aggregateSpans(query), {
			freshness: "live",
		});
	} catch (err) {
		if (err instanceof UnsupportedCapabilityError) {
			return ensureMeta(await computeAggregateSpansL1(adapter, query), {
				degraded: "sample",
				freshness: "sampled",
			});
		}
		throw err;
	}
}

/**
 * Plan spanTimeSeries: L0 native (when available) → L2 rollup → L1 sample.
 */
export async function planAndSpanTimeSeries(
	adapter: DataSourceAdapter,
	query: OpenLITQuery,
	opts?: {
		preferRollup?: boolean;
		readRollup?: (q: OpenLITQuery) => Promise<DataFrame | null>;
	}
): Promise<DataFrame> {
	if (hasServerAggregation(adapter)) {
		return ensureMeta(await adapter.spanTimeSeries(query), {
			freshness: "live",
		});
	}

	const rollup = await tryRollup(query, opts);
	if (rollup) return rollup;

	try {
		return ensureMeta(await adapter.spanTimeSeries(query), {
			freshness: "live",
		});
	} catch (err) {
		if (err instanceof UnsupportedCapabilityError) {
			return ensureMeta(await computeSpanTimeSeriesL1(adapter, query), {
				degraded: "sample",
				freshness: "sampled",
			});
		}
		throw err;
	}
}

/**
 * Plan distinctValues: L0 native → adapter method → L1 sample.
 */
export async function planAndDistinctValues(
	adapter: DataSourceAdapter,
	key: string,
	query: OpenLITQuery
): Promise<string[]> {
	try {
		return await adapter.distinctValues(key, query);
	} catch (err) {
		if (err instanceof UnsupportedCapabilityError) {
			return computeDistinctValuesL1(adapter, key, query);
		}
		throw err;
	}
}
