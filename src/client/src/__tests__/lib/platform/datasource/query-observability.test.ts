import { logQueryObservability } from "@/lib/platform/connectors/datasource/query-observability";

describe("logQueryObservability", () => {
	const originalNodeEnv = process.env.NODE_ENV;
	const originalFlag = process.env.OPENLIT_QUERY_OBSERVABILITY;
	let debugSpy: jest.SpyInstance;

	beforeEach(() => {
		debugSpy = jest.spyOn(console, "debug").mockImplementation(() => undefined);
	});

	afterEach(() => {
		debugSpy.mockRestore();
		(process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
		if (originalFlag === undefined) {
			delete process.env.OPENLIT_QUERY_OBSERVABILITY;
		} else {
			process.env.OPENLIT_QUERY_OBSERVABILITY = originalFlag;
		}
	});

	it("logs by default outside production", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		delete process.env.OPENLIT_QUERY_OBSERVABILITY;

		logQueryObservability({ sourceType: "loki", signal: "logs" }, undefined, 3);

		expect(debugSpy).toHaveBeenCalledTimes(1);
		const [, payload] = debugSpy.mock.calls[0];
		expect(JSON.parse(payload)).toMatchObject({
			source: "loki",
			signal: "logs",
			rows: 3,
		});
	});

	it("is disabled by default in production", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "production";
		delete process.env.OPENLIT_QUERY_OBSERVABILITY;

		logQueryObservability({ sourceType: "loki", signal: "logs" }, undefined, 3);

		expect(debugSpy).not.toHaveBeenCalled();
	});

	it("force-enables via flag=1 even in production", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "production";
		process.env.OPENLIT_QUERY_OBSERVABILITY = "1";

		logQueryObservability({ sourceType: "tempo", signal: "traces" }, undefined, 0);

		expect(debugSpy).toHaveBeenCalledTimes(1);
	});

	it("force-enables via flag=true even in production", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "production";
		process.env.OPENLIT_QUERY_OBSERVABILITY = "true";

		logQueryObservability({ sourceType: "tempo", signal: "traces" }, undefined, 0);

		expect(debugSpy).toHaveBeenCalledTimes(1);
	});

	it("force-disables via flag=0 outside production", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		process.env.OPENLIT_QUERY_OBSERVABILITY = "0";

		logQueryObservability({ sourceType: "tempo", signal: "traces" }, undefined, 0);

		expect(debugSpy).not.toHaveBeenCalled();
	});

	it("force-disables via flag=false outside production", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		process.env.OPENLIT_QUERY_OBSERVABILITY = "false";

		logQueryObservability({ sourceType: "tempo", signal: "traces" }, undefined, 0);

		expect(debugSpy).not.toHaveBeenCalled();
	});

	it("skips built-in sources regardless of the flag", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		process.env.OPENLIT_QUERY_OBSERVABILITY = "1";

		logQueryObservability(
			{ sourceType: "clickhouse", signal: "traces", isBuiltIn: true },
			undefined,
			10
		);

		expect(debugSpy).not.toHaveBeenCalled();
	});

	it("includes mode and full meta fields when present", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		delete process.env.OPENLIT_QUERY_OBSERVABILITY;

		logQueryObservability(
			{ sourceType: "prometheus", signal: "metrics", mode: "aggregate" },
			{
				latencyMs: 42,
				rowsScanned: 100,
				freshness: "sampled",
				truncated: true,
				degraded: ["serverAggregation", "rollup"],
			},
			5
		);

		const [, payload] = debugSpy.mock.calls[0];
		expect(JSON.parse(payload)).toEqual({
			source: "prometheus",
			signal: "metrics",
			mode: "aggregate",
			rows: 5,
			latencyMs: 42,
			scanned: 100,
			freshness: "sampled",
			truncated: 1,
			degraded: "serverAggregation,rollup",
		});
	});

	it("omits optional fields entirely when meta is absent", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		delete process.env.OPENLIT_QUERY_OBSERVABILITY;

		logQueryObservability({ sourceType: "jaeger", signal: "traces" }, undefined, 0);

		const [, payload] = debugSpy.mock.calls[0];
		const parsed = JSON.parse(payload);
		expect(parsed).toEqual({ source: "jaeger", signal: "traces", rows: 0 });
		expect(parsed).not.toHaveProperty("mode");
		expect(parsed).not.toHaveProperty("latencyMs");
		expect(parsed).not.toHaveProperty("scanned");
		expect(parsed).not.toHaveProperty("freshness");
		expect(parsed).not.toHaveProperty("truncated");
		expect(parsed).not.toHaveProperty("degraded");
	});

	it("treats truncated=false and empty degraded as absent", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		delete process.env.OPENLIT_QUERY_OBSERVABILITY;

		logQueryObservability(
			{ sourceType: "jaeger", signal: "traces" },
			{ truncated: false, degraded: [] },
			1
		);

		const [, payload] = debugSpy.mock.calls[0];
		const parsed = JSON.parse(payload);
		expect(parsed).not.toHaveProperty("truncated");
		expect(parsed).not.toHaveProperty("degraded");
	});

	it("falls back rowCount to 0 when NaN", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		delete process.env.OPENLIT_QUERY_OBSERVABILITY;

		logQueryObservability({ sourceType: "jaeger", signal: "traces" }, undefined, NaN);

		const [, payload] = debugSpy.mock.calls[0];
		expect(JSON.parse(payload).rows).toBe(0);
	});

	it("sanitizes control characters and truncates long tokens", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		delete process.env.OPENLIT_QUERY_OBSERVABILITY;

		logQueryObservability(
			{
				sourceType: "loki\r\ninjected: true",
				signal: "logs",
				mode: "a".repeat(100),
			},
			{ freshness: "live" as const },
			1
		);

		const [, payload] = debugSpy.mock.calls[0];
		expect(payload).not.toMatch(/[\n\r]/);
		const parsed = JSON.parse(payload);
		expect(parsed.source).toBe("lokiinjected: true");
		expect(parsed.mode).toHaveLength(64);
	});

	it("defaults sanitized tokens to empty string when the source value is nullish", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		delete process.env.OPENLIT_QUERY_OBSERVABILITY;

		logQueryObservability(
			{ sourceType: undefined as unknown as string, signal: "logs" },
			undefined,
			1
		);

		const [, payload] = debugSpy.mock.calls[0];
		expect(JSON.parse(payload).source).toBe("");
	});

	it("falls back latencyMs/rowsScanned to 0 when NaN rather than dropping the field", () => {
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		delete process.env.OPENLIT_QUERY_OBSERVABILITY;

		logQueryObservability(
			{ sourceType: "loki", signal: "logs" },
			{ latencyMs: NaN, rowsScanned: NaN },
			1
		);

		const [, payload] = debugSpy.mock.calls[0];
		const parsed = JSON.parse(payload);
		expect(parsed.latencyMs).toBe(0);
		expect(parsed.scanned).toBe(0);
	});

	it("never throws even if console.debug throws", () => {
		debugSpy.mockImplementation(() => {
			throw new Error("boom");
		});
		(process.env as Record<string, string | undefined>).NODE_ENV = "development";
		delete process.env.OPENLIT_QUERY_OBSERVABILITY;

		expect(() =>
			logQueryObservability({ sourceType: "loki", signal: "logs" }, undefined, 1)
		).not.toThrow();
	});
});
