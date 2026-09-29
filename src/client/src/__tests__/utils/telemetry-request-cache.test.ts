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
		expect(isCacheableTelemetryUrl("/api/telemetry/request/grouped")).toBe(true);
		expect(isCacheableTelemetryUrl("/api/telemetry/summary/traces")).toBe(true);
		expect(isCacheableTelemetryUrl("/api/agents/foo")).toBe(false);
	});

	it("resolves absolute URLs against their pathname", () => {
		expect(
			isCacheableTelemetryUrl("https://app.example.com/api/metrics/summary")
		).toBe(true);
		expect(
			isCacheableTelemetryUrl("https://app.example.com/api/agents/foo")
		).toBe(false);
	});

	it("treats an unparsable absolute URL as not cacheable", () => {
		expect(isCacheableTelemetryUrl("http://")).toBe(false);
	});

	it("normalizes a CUSTOM range's start/end to ISO strings without quantizing", () => {
		const normalized = normalizeTelemetryCacheBody(
			JSON.stringify({
				timeLimit: {
					type: "CUSTOM",
					start: "2026-07-10T12:00:10.123Z",
					end: new Date("2026-07-11T12:00:25.456Z"),
				},
			})
		);
		expect(JSON.parse(normalized)).toEqual({
			timeLimit: {
				type: "CUSTOM",
				start: "2026-07-10T12:00:10.123Z",
				end: "2026-07-11T12:00:25.456Z",
			},
		});
	});

	it("leaves non-string/non-Date CUSTOM start/end values untouched", () => {
		const normalized = normalizeTelemetryCacheBody(
			JSON.stringify({
				timeLimit: { type: "CUSTOM", start: null, end: 12345 },
			})
		);
		expect(JSON.parse(normalized)).toEqual({
			timeLimit: { type: "CUSTOM", start: null, end: 12345 },
		});
	});

	it("leaves non-string/non-Date relative start/end values untouched", () => {
		const normalized = normalizeTelemetryCacheBody(
			JSON.stringify({ timeLimit: { type: "24HR", start: 123, end: null } })
		);
		expect(JSON.parse(normalized)).toEqual({
			timeLimit: { type: "24HR", start: 123, end: null },
		});
	});

	it("leaves an unparsable relative date string untouched", () => {
		const normalized = normalizeTelemetryCacheBody(
			JSON.stringify({
				timeLimit: { type: "24HR", start: "not-a-date", end: "2026-07-11T12:00:00.000Z" },
			})
		);
		expect(JSON.parse(normalized).timeLimit.start).toBe("not-a-date");
	});

	it("leaves the body untouched when timeLimit has no type", () => {
		const body = JSON.stringify({ timeLimit: { start: "a", end: "b" } });
		expect(normalizeTelemetryCacheBody(body)).toBe(body);
	});

	it("leaves the body untouched when there is no timeLimit field", () => {
		const body = JSON.stringify({ foo: "bar" });
		expect(normalizeTelemetryCacheBody(body)).toBe(body);
	});

	it("returns an empty string for an undefined body", () => {
		expect(normalizeTelemetryCacheBody(undefined)).toBe("");
	});

	it("returns the raw body unchanged when it is not valid JSON", () => {
		expect(normalizeTelemetryCacheBody("not-json{{")).toBe("not-json{{");
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
		await withTelemetryRequestCache("/api/telemetry/request", "{}", async () => ({
			ok: true,
		}));
		expect(
			peekTelemetryRequestCache("/api/telemetry/request", "{}")
		).toEqual({ ok: true });
	});

	it("dedupes concurrent loads and serves TTL hits", async () => {
		let loads = 0;
		const loader = async () => {
			loads += 1;
			return { ok: true, loads };
		};
		const a = withTelemetryRequestCache("/api/telemetry/request", "{}", loader);
		const b = withTelemetryRequestCache("/api/telemetry/request", "{}", loader);
		const [ra, rb] = await Promise.all([a, b]);
		expect(ra).toEqual(rb);
		expect(loads).toBe(1);

		const c = await withTelemetryRequestCache(
			"/api/telemetry/request",
			"{}",
			loader
		);
		expect(c).toEqual(ra);
		expect(loads).toBe(1);
	});

	it("bypasses the cache entirely for non-cacheable URLs", async () => {
		let loads = 0;
		const loader = async () => {
			loads += 1;
			return { ok: true };
		};
		await withTelemetryRequestCache("/api/agents/foo", "{}", loader);
		await withTelemetryRequestCache("/api/agents/foo", "{}", loader);
		expect(loads).toBe(2);
		expect(peekTelemetryRequestCache("/api/agents/foo", "{}")).toBeNull();
	});

	it("peek returns null for non-cacheable URLs and cache misses", () => {
		expect(peekTelemetryRequestCache("/api/agents/foo", "{}")).toBeNull();
		expect(
			peekTelemetryRequestCache("/api/telemetry/request", "{}")
		).toBeNull();
	});

	it("re-runs the loader once a TTL-expired entry is re-requested", async () => {
		let loads = 0;
		const loader = async () => {
			loads += 1;
			return { ok: true, loads };
		};
		await withTelemetryRequestCache("/api/telemetry/request", "{}", loader, 1);
		await new Promise((resolve) => setTimeout(resolve, 5));
		const second = await withTelemetryRequestCache(
			"/api/telemetry/request",
			"{}",
			loader,
			1
		);
		expect(loads).toBe(2);
		expect(second).toEqual({ ok: true, loads: 2 });
	});

	it("evicts the oldest entries once the store exceeds MAX_ENTRIES", async () => {
		for (let i = 0; i < 85; i += 1) {
			await withTelemetryRequestCache(
				"/api/telemetry/request",
				JSON.stringify({ i }),
				async () => ({ i })
			);
		}
		expect(
			peekTelemetryRequestCache("/api/telemetry/request", JSON.stringify({ i: 0 }))
		).toBeNull();
		expect(
			peekTelemetryRequestCache(
				"/api/telemetry/request",
				JSON.stringify({ i: 84 })
			)
		).toEqual({ i: 84 });
	});

	it("prunes expired entries before enforcing the MAX_ENTRIES cap", async () => {
		await withTelemetryRequestCache(
			"/api/telemetry/request",
			JSON.stringify({ tag: "expiring" }),
			async () => ({ tag: "expiring" }),
			1
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await withTelemetryRequestCache(
			"/api/telemetry/request",
			JSON.stringify({ tag: "fresh" }),
			async () => ({ tag: "fresh" })
		);
		expect(
			peekTelemetryRequestCache(
				"/api/telemetry/request",
				JSON.stringify({ tag: "expiring" })
			)
		).toBeNull();
		expect(
			peekTelemetryRequestCache(
				"/api/telemetry/request",
				JSON.stringify({ tag: "fresh" })
			)
		).toEqual({ tag: "fresh" });
	});

	it("propagates loader rejections without caching the failure", async () => {
		const loader = jest
			.fn()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce({ ok: true });

		await expect(
			withTelemetryRequestCache("/api/telemetry/request", "{}", loader)
		).rejects.toThrow("boom");
		expect(peekTelemetryRequestCache("/api/telemetry/request", "{}")).toBeNull();

		const result = await withTelemetryRequestCache(
			"/api/telemetry/request",
			"{}",
			loader
		);
		expect(result).toEqual({ ok: true });
	});
});
