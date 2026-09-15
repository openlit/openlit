jest.mock("@/lib/platform/traces/read", () => ({
	listTraceRecords: jest.fn(),
}));

import { listTraceRecords } from "@/lib/platform/traces/read";
import {
	getRuleTraceFieldValue,
	listRecentRuleTraces,
} from "@/lib/platform/rule-engine/telemetry";

describe("listRecentRuleTraces", () => {
	it("uses ClickHouse-compatible ISO timestamps for preview", async () => {
		(listTraceRecords as jest.Mock).mockResolvedValue({
			err: null,
			records: [],
		});

		await listRecentRuleTraces(100, "production");

		const params = (listTraceRecords as jest.Mock).mock.calls[0][0];
		expect(params.timeLimit.start).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
		expect(params.timeLimit.end).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
		expect(
			new Date(params.timeLimit.end).getTime() -
				new Date(params.timeLimit.start).getTime()
		).toBe(30 * 24 * 60 * 60 * 1000);
		expect(params.environment).toBe("production");
	});

	it("reads deployment.environment from the OTel resource attribute", () => {
		expect(
			getRuleTraceFieldValue(
				{
					ResourceAttributes: { "deployment.environment": "production" },
					SpanAttributes: { "gen_ai.environment": "legacy" },
				},
				"deployment.environment"
			)
		).toBe("production");
	});

	it("throws when the underlying trace read reports an error", async () => {
		(listTraceRecords as jest.Mock).mockResolvedValue({
			err: "boom",
			records: [],
		});

		await expect(listRecentRuleTraces()).rejects.toThrow("boom");
	});

	it("defaults limit/environment and returns an empty list when records is missing", async () => {
		(listTraceRecords as jest.Mock).mockResolvedValue({ err: null });

		const records = await listRecentRuleTraces();
		expect(records).toEqual([]);
		const calls = (listTraceRecords as jest.Mock).mock.calls;
		const params = calls[calls.length - 1][0];
		expect(params.limit).toBe(100);
		expect(params.environment).toBeUndefined();
	});

	it("falls back to the span-level deployment.environment attribute when the resource attribute is missing", () => {
		expect(
			getRuleTraceFieldValue(
				{ SpanAttributes: { "deployment.environment": "staging" } },
				"deployment.environment"
			)
		).toBe("staging");
	});

	it("falls back to gen_ai.environment when no deployment.environment attribute exists", () => {
		expect(
			getRuleTraceFieldValue(
				{ SpanAttributes: { "gen_ai.environment": "legacy-env" } },
				"deployment.environment"
			)
		).toBe("legacy-env");
	});

	it("returns an empty string when no environment attribute is present at all", () => {
		expect(getRuleTraceFieldValue({}, "deployment.environment")).toBe("");
	});

	it("reads a mapped span-attribute field", () => {
		expect(
			getRuleTraceFieldValue(
				{ SpanAttributes: { "gen_ai.system": "openai" } },
				"gen_ai.system"
			)
		).toBe("openai");
	});

	it("returns an empty string for a mapped attribute field with no value present", () => {
		expect(getRuleTraceFieldValue({}, "gen_ai.request.model")).toBe("");
	});

	it("reads a mapped direct field", () => {
		expect(
			getRuleTraceFieldValue({ ServiceName: "checkout-api" }, "ServiceName")
		).toBe("checkout-api");
	});

	it("falls back to indexing the trace by the raw field name when unmapped", () => {
		expect(getRuleTraceFieldValue({ CustomColumn: "value-1" }, "CustomColumn")).toBe(
			"value-1"
		);
	});

	it("returns an empty string when an unmapped field is absent", () => {
		expect(getRuleTraceFieldValue({}, "NotARealField")).toBe("");
	});
});
