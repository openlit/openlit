import {
	DIRECT_INTELLIGENCE_READ_FEATURES,
	OPENPLAIT_CLICKHOUSE_READ_FEATURES,
} from "@/lib/platform/openplait/features";
import { openPlaitFramesToRows } from "@/lib/platform/openplait/frames";
import { normalizeOpenPlaitReadStatement } from "@/lib/platform/openplait/native";

describe("OpenPlait ClickHouse integration", () => {
	it("normalizes a trailing SQL terminator for OpenPlait native mode", () => {
		expect(normalizeOpenPlaitReadStatement("  SELECT 1;  ")).toBe("SELECT 1");
		expect(normalizeOpenPlaitReadStatement("SELECT ';' AS value")).toBe(
			"SELECT ';' AS value"
		);
	});

	it("converts columnar OpenPlait frames to legacy OpenLIT rows", () => {
		expect(
			openPlaitFramesToRows([
				{
					name: "telemetry",
					length: 2,
					fields: [
						{ name: "TraceId", type: "string", values: ["a", "b"] },
						{ name: "Duration", type: "number", values: [10, 20] },
					],
				},
			])
		).toEqual([
			{ TraceId: "a", Duration: 10 },
			{ TraceId: "b", Duration: 20 },
		]);
	});

	it("separates routed product reads from direct intelligence reads", () => {
		expect(OPENPLAIT_CLICKHOUSE_READ_FEATURES).toEqual(
			expect.arrayContaining([
				"traces",
				"logs",
				"metrics",
				"telemetry",
				"openground",
				"rule-engine",
				"evaluations",
				"dashboards",
				"alerts",
			])
		);
		expect(DIRECT_INTELLIGENCE_READ_FEATURES).toEqual(
			expect.arrayContaining([
				"otter",
				"ai-analysis",
				"coding-agents",
				"telemetry-rollups",
			])
		);
	});
});
