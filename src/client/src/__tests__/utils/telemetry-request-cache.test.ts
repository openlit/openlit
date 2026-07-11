import {
	__clearTelemetryRequestCache,
	isCacheableTelemetryUrl,
	normalizeTelemetryCacheBody,
	peekTelemetryRequestCache,
	withTelemetryRequestCache,
} from "@/utils/telemetry-request-cache";

describe("telemetry-request-cache", () => {
	beforeEach(() => {
		__clearTelemetryRequestCache();
	});

	it("only caches telemetry/metrics URLs", () => {
		expect(isCacheableTelemetryUrl("/api/metrics/request/grouped")).toBe(true);
		expect(isCacheableTelemetryUrl("/api/telemetry/summary/traces")).toBe(true);
		expect(isCacheableTelemetryUrl("/api/agents/foo")).toBe(false);
	});

	it("quantizes relative timeLimit ends so remounts share a cache key", () => {
		const a = normalizeTelemetryCacheBody(
			JSON.stringify({
				timeLimit: {
					type: "24HR",
					start: "2026-07-10T12:00:10.000Z",
					end: "2026-07-11T12:00:10.000Z",
				},
			})
		);
		const b = normalizeTelemetryCacheBody(
			JSON.stringify({
				timeLimit: {
					type: "24HR",
					start: "2026-07-10T12:00:25.000Z",
					end: "2026-07-11T12:00:25.000Z",
				},
			})
		);
		expect(a).toBe(b);
	});

	it("seeds peek after a successful cache write", async () => {
		await withTelemetryRequestCache("/api/metrics/request", "{}", async () => ({
			ok: true,
		}));
		expect(
			peekTelemetryRequestCache("/api/metrics/request", "{}")
		).toEqual({ ok: true });
	});

	it("dedupes concurrent loads and serves TTL hits", async () => {
		let loads = 0;
		const loader = async () => {
			loads += 1;
			return { ok: true, loads };
		};
		const a = withTelemetryRequestCache("/api/metrics/request", "{}", loader);
		const b = withTelemetryRequestCache("/api/metrics/request", "{}", loader);
		const [ra, rb] = await Promise.all([a, b]);
		expect(ra).toEqual(rb);
		expect(loads).toBe(1);

		const c = await withTelemetryRequestCache(
			"/api/metrics/request",
			"{}",
			loader
		);
		expect(c).toEqual(ra);
		expect(loads).toBe(1);
	});
});
