import type { DataFrame, OpenLITQuery } from "./types";
import {
	fetchSpansForAggregation,
	type SampleFetchSource,
} from "./graph/sample-fetch";
import {
	aggregateSpansInProcess,
	bucketSpansByInterval,
	distinctFromSpans,
} from "./graph/sample-aggregate";

function withL1Meta(
	frame: DataFrame,
	opts: {
		start: number;
		spansScanned: number;
		truncated: boolean;
	}
): DataFrame {
	return {
		...frame,
		meta: {
			...frame.meta,
			degraded: ["serverAggregation"],
			truncated: opts.truncated,
			latencyMs: Date.now() - opts.start,
			rowsScanned: opts.spansScanned,
		},
	};
}

/** L1: sample spans then groupBy + aggregate in-process. */
export async function computeAggregateSpansL1(
	source: SampleFetchSource,
	query: OpenLITQuery
): Promise<DataFrame> {
	const start = Date.now();
	const { spans, truncated } = await fetchSpansForAggregation(source, query);
	const frame = aggregateSpansInProcess(
		spans,
		query.groupBy || [],
		query.aggregations || [{ fn: "count" }]
	);
	return withL1Meta(frame, {
		start,
		spansScanned: spans.length,
		truncated,
	});
}

/** L1: sample spans then bucket by interval in-process. */
export async function computeSpanTimeSeriesL1(
	source: SampleFetchSource,
	query: OpenLITQuery
): Promise<DataFrame> {
	const start = Date.now();
	const { spans, truncated } = await fetchSpansForAggregation(source, query);
	const frame = bucketSpansByInterval(
		spans,
		query.interval || "1h",
		query.aggregations || [{ fn: "count" }],
		query.timeRange
	);
	return withL1Meta(frame, {
		start,
		spansScanned: spans.length,
		truncated,
	});
}

/** L1: sample spans then collect distinct field values. */
export async function computeDistinctValuesL1(
	source: SampleFetchSource,
	key: string,
	query: OpenLITQuery
): Promise<string[]> {
	const { spans } = await fetchSpansForAggregation(source, query);
	return distinctFromSpans(spans, key);
}
