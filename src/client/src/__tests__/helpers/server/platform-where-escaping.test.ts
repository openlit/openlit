import { getFilterWhereCondition } from "@/helpers/server/platform";

const INJECTION = "x') OR 1=1 OR ('";

function where(selectedConfig: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	return getFilterWhereCondition(
		{
			timeLimit: { start: "2026-10-01 00:00:00", end: "2026-10-02 00:00:00" },
			selectedConfig,
			...extra,
		} as any,
		true
	);
}

describe("getFilterWhereCondition escaping", () => {
	it.each(["models", "providers", "traceTypes", "applicationNames", "spanNames"])(
		"escapes quotes in %s",
		(key) => {
			const sql = where({ [key]: [INJECTION] });
			expect(sql).toContain("x\\') OR 1=1 OR (\\'");
			expect(sql).not.toContain("'x') OR 1=1");
		}
	);

	it("escapes the time range", () => {
		const sql = getFilterWhereCondition(
			{ timeLimit: { start: INJECTION, end: "2026-10-02" }, selectedConfig: {} } as any,
			true
		);
		expect(sql).toContain("parseDateTimeBestEffort('x\\') OR 1=1 OR (\\'')");
	});

	it("escapes status codes", () => {
		const sql = where({}, { statusCode: [INJECTION] });
		expect(sql).toContain("StatusCode IN ('x\\') OR 1=1 OR (\\'')");
	});

	it("coerces maxCost to a number", () => {
		const sql = where({ maxCost: "1) OR (1" });
		expect(sql).not.toContain("OR (1");
	});
});

import { validateMetricsRequest, validateMetricsRequestType, isSafeTimestamp } from "@/helpers/server/platform";

describe("validateMetricsRequest sanitisation", () => {
	it.each(["2026-10-01", "2026-10-01 00:00:00", "2026-10-01T00:00:00.000Z", "2026-10-01T05:30:00+05:30"])(
		"accepts %s",
		(value) => expect(isSafeTimestamp(value)).toBe(true)
	);

	it.each(["x') OR 1=1 --", "2026-10-01' OR '1", "now()", "", "2026-13-45T99:99"])("rejects %s", (value) => {
		expect(isSafeTimestamp(value)).toBe(false);
	});

	it("rejects an injected time range before any SQL is built", () => {
		const result = validateMetricsRequest(
			{ timeLimit: { start: "x') OR 1=1 --", end: "2026-10-02" } },
			validateMetricsRequestType.GET_ALL
		);
		expect(result.success).toBe(false);
	});

	it("coerces limit, offset, and top to bounded integers", () => {
		const params: Record<string, any> = {
			timeLimit: { start: "2026-10-01", end: "2026-10-02" },
			limit: "10 UNION ALL SELECT 1",
			offset: "-5",
			top: "3",
		};
		expect(validateMetricsRequest(params, validateMetricsRequestType.TOP_MODELS).success).toBe(true);
		expect(params).toMatchObject({ limit: 10, offset: 0, top: 3 });
	});
});
