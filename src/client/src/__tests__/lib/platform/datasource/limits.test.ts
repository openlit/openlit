import {
	clampQueryBudget,
	DEFAULT_QUERY_BUDGET,
	Semaphore,
	withSourceConcurrency,
	withRetry,
	defaultIsRetryable,
	__resetConcurrencyForTests,
} from "@/lib/platform/datasource/http/limits";
import type { OpenLITQuery } from "@/lib/platform/datasource/types";
import { SourceResponseError } from "@/lib/platform/datasource/http/safe-fetch";

beforeEach(() => {
	__resetConcurrencyForTests();
});

const baseQuery = (over: Partial<OpenLITQuery> = {}): OpenLITQuery => ({
	signal: "traces",
	timeRange: { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2026-07-02T00:00:00Z") },
	...over,
});

describe("clampQueryBudget", () => {
	it("clamps a limit over the budget and reports it", () => {
		const { query, clamped } = clampQueryBudget(baseQuery({ limit: 999999 }));
		expect(query.limit).toBe(DEFAULT_QUERY_BUDGET.maxRows);
		expect(clamped).toContain("limit");
	});

	it("defaults a missing limit to the budget max without flagging", () => {
		const { query, clamped } = clampQueryBudget(baseQuery());
		expect(query.limit).toBe(DEFAULT_QUERY_BUDGET.maxRows);
		expect(clamped).not.toContain("limit");
	});

	it("clamps an over-wide time range by moving start forward", () => {
		const end = new Date("2026-07-02T00:00:00Z");
		const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
		const { query, clamped } = clampQueryBudget(baseQuery({ timeRange: { start, end } }));
		expect(clamped).toContain("timeRange");
		expect(query.timeRange.end).toEqual(end);
		expect(end.getTime() - query.timeRange.start.getTime()).toBe(
			DEFAULT_QUERY_BUDGET.maxRangeMs
		);
	});

	it("leaves an in-budget query untouched", () => {
		const { query, clamped } = clampQueryBudget(baseQuery({ limit: 100 }));
		expect(query.limit).toBe(100);
		expect(clamped).toHaveLength(0);
	});

	it("clamps start to the vendor lookback window when tighter than maxRangeMs", () => {
		const end = new Date("2026-07-10T00:00:00Z");
		const start = new Date(end.getTime() - 20 * 24 * 60 * 60 * 1000); // 20d
		const maxLookbackMs = 7 * 24 * 60 * 60 * 1000; // 7d retention
		const { query, clamped } = clampQueryBudget(
			baseQuery({ timeRange: { start, end } }),
			{ ...DEFAULT_QUERY_BUDGET, maxLookbackMs }
		);
		expect(query.timeRange.end).toEqual(end);
		expect(end.getTime() - query.timeRange.start.getTime()).toBe(maxLookbackMs);
		// Range was inside maxRangeMs (30d) but outside the 7d lookback.
		expect(clamped).toContain("maxLookback");
		expect(clamped).not.toContain("timeRange");
	});

	it("keeps an in-lookback range untouched", () => {
		const end = new Date("2026-07-10T00:00:00Z");
		const start = new Date(end.getTime() - 3 * 24 * 60 * 60 * 1000); // 3d
		const maxLookbackMs = 7 * 24 * 60 * 60 * 1000;
		const { query, clamped } = clampQueryBudget(
			baseQuery({ timeRange: { start, end } }),
			{ ...DEFAULT_QUERY_BUDGET, maxLookbackMs }
		);
		expect(query.timeRange.start).toEqual(start);
		expect(clamped).not.toContain("maxLookback");
	});
});

describe("Semaphore", () => {
	it("caps concurrent holders and releases in order", async () => {
		const sem = new Semaphore(2);
		const r1 = await sem.acquire();
		const r2 = await sem.acquire();
		let thirdAcquired = false;
		const p3 = sem.acquire().then((rel) => {
			thirdAcquired = true;
			return rel;
		});
		await Promise.resolve();
		expect(thirdAcquired).toBe(false);
		r1();
		const r3 = await p3;
		expect(thirdAcquired).toBe(true);
		r2();
		r3();
	});
});

describe("withSourceConcurrency", () => {
	it("never exceeds the cap for a key", async () => {
		let active = 0;
		let maxActive = 0;
		const task = () =>
			withSourceConcurrency("src-1", 2, async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((r) => setTimeout(r, 5));
				active--;
			});
		await Promise.all([task(), task(), task(), task(), task()]);
		expect(maxActive).toBeLessThanOrEqual(2);
	});
});

describe("defaultIsRetryable", () => {
	it("retries 429 and 5xx SourceResponseError", () => {
		expect(defaultIsRetryable(new SourceResponseError(429, "rate"))).toBe(true);
		expect(defaultIsRetryable(new SourceResponseError(503, "down"))).toBe(true);
		expect(defaultIsRetryable(new SourceResponseError(400, "bad"))).toBe(false);
	});

	it("retries network/timeout errors", () => {
		expect(defaultIsRetryable(new Error("Data source request timed out"))).toBe(true);
		expect(defaultIsRetryable(new Error("fetch failed"))).toBe(true);
		expect(defaultIsRetryable(new Error("bad request"))).toBe(false);
	});
});

describe("withRetry", () => {
	it("retries transient failures then succeeds", async () => {
		let calls = 0;
		const result = await withRetry(
			async () => {
				calls++;
				if (calls < 3) throw new SourceResponseError(503, "down");
				return "ok";
			},
			{ retries: 3, baseDelayMs: 1, sleep: async () => {} }
		);
		expect(result).toBe("ok");
		expect(calls).toBe(3);
	});

	it("does not retry non-retryable errors", async () => {
		let calls = 0;
		await expect(
			withRetry(
				async () => {
					calls++;
					throw new SourceResponseError(400, "bad");
				},
				{ retries: 3, sleep: async () => {} }
			)
		).rejects.toBeInstanceOf(SourceResponseError);
		expect(calls).toBe(1);
	});

	it("gives up after exhausting retries", async () => {
		let calls = 0;
		await expect(
			withRetry(
				async () => {
					calls++;
					throw new SourceResponseError(500, "down");
				},
				{ retries: 2, baseDelayMs: 1, sleep: async () => {} }
			)
		).rejects.toBeInstanceOf(SourceResponseError);
		expect(calls).toBe(3);
	});
});
