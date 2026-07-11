import {
	DEFAULT_MAX_DATA_POINTS,
	MIN_INTERVAL_MS,
	MAX_SERIES_POINTS,
	roundIntervalMs,
	computeIntervalMs,
	rateIntervalMs,
	clampStepMs,
	parseDurationMs,
	intervalMsToLabel,
	intervalMsToSeconds,
	alignRangeToStep,
} from "@/lib/platform/datasource/downsample";
import type { QueryTimeRange } from "@/lib/platform/datasource/types";

const range = (ms: number): QueryTimeRange => {
	const end = new Date("2026-07-10T12:00:00Z");
	return { start: new Date(end.getTime() - ms), end };
};

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("roundIntervalMs", () => {
	it("snaps a raw interval up to the nearest nice step", () => {
		expect(roundIntervalMs(7_000)).toBe(10_000);
		expect(roundIntervalMs(12_000)).toBe(30_000);
		expect(roundIntervalMs(45_000)).toBe(MIN);
		expect(roundIntervalMs(4 * MIN)).toBe(5 * MIN);
	});

	it("rounds up to whole days beyond a week", () => {
		const eightDays = 8 * DAY;
		expect(roundIntervalMs(eightDays)).toBe(8 * DAY);
	});
});

describe("computeIntervalMs", () => {
	it("derives interval from range / maxDataPoints (Grafana math)", () => {
		// 1h over 300 points => ~12s raw => snaps to 30s.
		const ms = computeIntervalMs({
			timeRange: range(HOUR),
			maxDataPoints: DEFAULT_MAX_DATA_POINTS,
		});
		expect(ms).toBe(30_000);
	});

	it("never returns below the minimum interval", () => {
		const ms = computeIntervalMs({
			timeRange: range(MIN),
			maxDataPoints: 1000,
		});
		expect(ms).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
	});

	it("honors an explicit interval label over derived math", () => {
		const ms = computeIntervalMs({
			timeRange: range(DAY),
			maxDataPoints: 300,
			interval: "5m",
		});
		expect(ms).toBe(5 * MIN);
	});

	it("wider ranges produce coarser steps", () => {
		const hour = computeIntervalMs({ timeRange: range(HOUR), maxDataPoints: 300 });
		const week = computeIntervalMs({
			timeRange: range(7 * DAY),
			maxDataPoints: 300,
		});
		expect(week).toBeGreaterThan(hour);
	});
});

describe("rateIntervalMs", () => {
	it("is at least 4x the scrape interval", () => {
		expect(rateIntervalMs(10_000, 15_000)).toBe(60_000);
	});

	it("is step + scrape when that is larger", () => {
		expect(rateIntervalMs(120_000, 15_000)).toBe(135_000);
	});
});

describe("clampStepMs", () => {
	it("widens the step when points would exceed the cap", () => {
		const rangeMs = MAX_SERIES_POINTS * 10_000 * 2; // 2x the cap at 10s steps
		const step = clampStepMs(rangeMs, 10_000);
		expect(Math.ceil(rangeMs / step)).toBeLessThanOrEqual(MAX_SERIES_POINTS);
	});

	it("leaves an under-cap step unchanged", () => {
		expect(clampStepMs(HOUR, MIN)).toBe(MIN);
	});
});

describe("parseDurationMs", () => {
	it("parses compact and named durations", () => {
		expect(parseDurationMs("30s")).toBe(30_000);
		expect(parseDurationMs("5m")).toBe(5 * MIN);
		expect(parseDurationMs("1h")).toBe(HOUR);
		expect(parseDurationMs("1d")).toBe(DAY);
		expect(parseDurationMs("minute")).toBe(MIN);
		expect(parseDurationMs("hour")).toBe(HOUR);
	});

	it("returns 0 for invalid labels", () => {
		expect(parseDurationMs("nonsense")).toBe(0);
		expect(parseDurationMs("")).toBe(0);
	});
});

describe("interval formatting", () => {
	it("formats ms as a compact label", () => {
		expect(intervalMsToLabel(30_000)).toBe("30s");
		expect(intervalMsToLabel(5 * MIN)).toBe("5m");
		expect(intervalMsToLabel(HOUR)).toBe("1h");
		expect(intervalMsToLabel(DAY)).toBe("1d");
	});

	it("converts ms to integer Prometheus seconds", () => {
		expect(intervalMsToSeconds(30_000)).toBe(30);
		expect(intervalMsToSeconds(500)).toBe(1);
	});
});

describe("alignRangeToStep", () => {
	it("floors start and ceils end to the step so windows dedupe", () => {
		const start = new Date(1_000_000_000_123);
		const end = new Date(1_000_000_030_456);
		const aligned = alignRangeToStep({ start, end }, 30_000);
		expect(aligned.start.getTime() % 30_000).toBe(0);
		expect(aligned.end.getTime() % 30_000).toBe(0);
		expect(aligned.start.getTime()).toBeLessThanOrEqual(start.getTime());
		expect(aligned.end.getTime()).toBeGreaterThanOrEqual(end.getTime());
	});

	it("does not mutate the input range", () => {
		const start = new Date(1_000_000_000_123);
		const end = new Date(1_000_000_030_456);
		alignRangeToStep({ start, end }, 30_000);
		expect(start.getTime()).toBe(1_000_000_000_123);
		expect(end.getTime()).toBe(1_000_000_030_456);
	});
});
