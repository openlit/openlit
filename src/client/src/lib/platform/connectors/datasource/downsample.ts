/**
 * Pixel-bounded downsampling math (Grafana parity).
 *
 * Every time-series read computes a bucket/step from the requested range and a
 * target point count (`maxDataPoints`, usually the panel pixel width) so a wide
 * window never returns more points than the surface can render. This mirrors
 * Grafana's `PanelQueryRunner`/`rangeUtil.calculateInterval` behavior:
 *
 *   intervalMs = max(ceil(rangeMs / maxDataPoints), minIntervalMs), rounded to
 *   a "nice" human step.
 *
 * Adapters translate the resulting step into their native units (Prometheus
 * seconds, Tempo Go-duration, ClickHouse bucket labels).
 */

import type { OpenLITQuery, QueryTimeRange } from "./types";

/** Default target point count when a caller does not supply pixel width. */
export const DEFAULT_MAX_DATA_POINTS = 300;
/** Floor so we never ask a vendor for sub-second buckets. */
export const MIN_INTERVAL_MS = 10_000;
/** Hard ceiling on returned points regardless of range (protects the UI). */
export const MAX_SERIES_POINTS = 1_000;

/** "Nice" step ladder in ms — Grafana snaps the raw interval up to one of these. */
const NICE_STEPS_MS = [
	10_000, // 10s
	30_000, // 30s
	60_000, // 1m
	5 * 60_000, // 5m
	10 * 60_000, // 10m
	15 * 60_000, // 15m
	30 * 60_000, // 30m
	60 * 60_000, // 1h
	3 * 60 * 60_000, // 3h
	6 * 60 * 60_000, // 6h
	12 * 60 * 60_000, // 12h
	24 * 60 * 60_000, // 1d
	7 * 24 * 60 * 60_000, // 1w
];

/** Snap a raw interval up to the nearest "nice" step. */
export function roundIntervalMs(rawMs: number): number {
	for (const step of NICE_STEPS_MS) {
		if (rawMs <= step) return step;
	}
	// Beyond a week, round up to whole days.
	const day = 24 * 60 * 60_000;
	return Math.ceil(rawMs / day) * day;
}

function rangeMsOf(range: QueryTimeRange): number {
	return Math.max(0, range.end.getTime() - range.start.getTime());
}

/**
 * Compute the bucket interval in ms for a query. Honors an explicit
 * `query.interval` label when present; otherwise derives it from the range and
 * `maxDataPoints` (Grafana math) and rounds to a nice step.
 */
export function computeIntervalMs(
	query: Pick<OpenLITQuery, "timeRange" | "maxDataPoints" | "interval">,
	opts: { minIntervalMs?: number } = {}
): number {
	const minInterval = opts.minIntervalMs ?? MIN_INTERVAL_MS;
	const explicit = query.interval ? parseDurationMs(query.interval) : 0;
	if (explicit > 0) return Math.max(explicit, minInterval);

	const rangeMs = rangeMsOf(query.timeRange);
	const mdp =
		query.maxDataPoints && query.maxDataPoints > 0
			? query.maxDataPoints
			: DEFAULT_MAX_DATA_POINTS;
	const raw = Math.ceil(rangeMs / mdp);
	return roundIntervalMs(Math.max(raw, minInterval));
}

/**
 * Grafana `$__rate_interval` equivalent for rate/increase queries:
 * `max(step + scrapeInterval, 4 * scrapeInterval)` so short ranges still cover
 * at least a few scrapes. Defaults scrapeInterval to 15s.
 */
export function rateIntervalMs(stepMs: number, scrapeIntervalMs = 15_000): number {
	return Math.max(stepMs + scrapeIntervalMs, 4 * scrapeIntervalMs);
}

/**
 * Clamp the expected number of points for a range/step to `MAX_SERIES_POINTS`,
 * returning a (possibly widened) step that keeps the count under the cap.
 */
export function clampStepMs(rangeMs: number, stepMs: number): number {
	if (stepMs <= 0) return MIN_INTERVAL_MS;
	const points = Math.ceil(rangeMs / stepMs);
	if (points <= MAX_SERIES_POINTS) return stepMs;
	return Math.ceil(rangeMs / MAX_SERIES_POINTS);
}

/** Parse a duration label ("30s","5m","1h","1d","1w") to ms. Returns 0 if invalid. */
export function parseDurationMs(label: string): number {
	const raw = label.trim().toLowerCase();
	const named: Record<string, number> = {
		minute: 60_000,
		hour: 3_600_000,
		day: 86_400_000,
		week: 604_800_000,
		month: 2_592_000_000,
	};
	if (named[raw]) return named[raw];
	const m = raw.match(/^(\d+)\s*(ms|s|m|h|d|w)$/);
	if (!m) return 0;
	const n = Number(m[1]);
	const unit: Record<string, number> = {
		ms: 1,
		s: 1_000,
		m: 60_000,
		h: 3_600_000,
		d: 86_400_000,
		w: 604_800_000,
	};
	return n * (unit[m[2]] || 0);
}

/** Format a step in ms as a compact duration label ("30s","5m","1h","1d"). */
export function intervalMsToLabel(stepMs: number): string {
	const s = Math.max(1, Math.round(stepMs / 1000));
	if (s % 86400 === 0) return `${s / 86400}d`;
	if (s % 3600 === 0) return `${s / 3600}h`;
	if (s % 60 === 0) return `${s / 60}m`;
	return `${s}s`;
}

/** Prometheus wants an integer seconds step. */
export function intervalMsToSeconds(stepMs: number): number {
	return Math.max(1, Math.round(stepMs / 1000));
}

/**
 * Align a time range down/up to a step boundary so identical windows within a
 * poll cycle hash to the same cache key (Grafana rounds range to interval to
 * dedupe). Returns new Date instances; never mutates the input.
 */
export function alignRangeToStep(
	range: QueryTimeRange,
	stepMs: number
): QueryTimeRange {
	if (stepMs <= 0) return range;
	const start = Math.floor(range.start.getTime() / stepMs) * stepMs;
	const end = Math.ceil(range.end.getTime() / stepMs) * stepMs;
	return { start: new Date(start), end: new Date(end) };
}
