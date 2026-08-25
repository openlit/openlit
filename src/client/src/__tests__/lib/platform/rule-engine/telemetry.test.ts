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
});
