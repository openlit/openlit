const mockConnectorDataCollector = jest.fn();

jest.mock("@/lib/platform/common", () => ({
	connectorDataCollector: (...args: unknown[]) => mockConnectorDataCollector(...args),
}));

jest.mock("@/lib/db-config", () => ({
	getDBConfigByIdForBackground: jest.fn().mockResolvedValue({ database: "openlit" }),
}));

import {
	queryConnectorTraces,
	resolveTracesTableRef,
} from "@/lib/platform/connectors/datasource/clickhouse/direct-read";

describe("clickhouse direct-read", () => {
	beforeEach(() => {
		mockConnectorDataCollector.mockReset();
	});

	it("resolveTracesTableRef qualifies with configured database", async () => {
		expect(await resolveTracesTableRef("cfg-1")).toBe(
			"`openlit`.`otel_traces`"
		);
	});

	it("queryConnectorTraces uses connectorDataCollector", async () => {
		mockConnectorDataCollector.mockResolvedValue({ data: [{ TraceId: "t1" }] });
		const result = await queryConnectorTraces(
			"SELECT TraceId FROM `openlit`.`otel_traces`",
			"cfg-1"
		);
		expect(mockConnectorDataCollector).toHaveBeenCalledWith(
			{ query: "SELECT TraceId FROM `openlit`.`otel_traces`" },
			"query",
			"cfg-1"
		);
		expect(result.data).toEqual([{ TraceId: "t1" }]);
	});
});
