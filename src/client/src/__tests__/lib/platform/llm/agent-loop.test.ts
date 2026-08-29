jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
}));

jest.mock("@/helpers/server/platform", () => ({
	getFilterPreviousParams: jest.fn((params) => params),
	getFilterWhereCondition: jest.fn(() => "1 = 1"),
}));

jest.mock("@/lib/telemetry-source", () => ({
	resolveTelemetrySourceDescriptor: jest.fn(async () => ({
		isBuiltIn: true,
		type: "clickhouse",
	})),
}));

jest.mock("@/lib/platform/connectors/datasource/facade", () => ({
	resolveSignalReadContext: jest.fn(),
}));

jest.mock("@/lib/platform/connectors/datasource/clickhouse/query-map", () => ({
	metricParamsToOpenLITQuery: jest.fn(() => ({
		signal: "traces",
		timeRange: { start: new Date(), end: new Date() },
	})),
}));

import { dataCollector } from "@/lib/platform/common";
import {
	getAgentLoop,
	summarizeAgentLoopFromSpans,
} from "@/lib/platform/llm/agent-loop";
import { resolveTelemetrySourceDescriptor } from "@/lib/telemetry-source";

const mockedDataCollector = dataCollector as jest.MockedFunction<
	typeof dataCollector
>;
const mockedResolve = resolveTelemetrySourceDescriptor as jest.MockedFunction<
	typeof resolveTelemetrySourceDescriptor
>;

const params = {
	timeLimit: {
		start: new Date("2024-01-01"),
		end: new Date("2024-01-02"),
		type: "custom",
	},
};

describe("getAgentLoop", () => {
	beforeEach(() => {
		mockedDataCollector.mockReset();
		mockedResolve.mockResolvedValue({
			isBuiltIn: true,
			type: "clickhouse",
		} as any);
	});

	it("counts looping traces against traces that recorded tool calls", async () => {
		mockedDataCollector.mockResolvedValue({
			data: [
				{
					tool_traces: 40,
					loops: 8,
					previous_tool_traces: 20,
					previous_loops: 2,
				},
			],
		});

		const result = await getAgentLoop(params);
		const row = result.data?.[0];
		expect(row?.tool_traces).toBe(40);
		expect(row?.loops).toBe(8);
		expect(row?.loops_pct).toBe(20);
		const query = mockedDataCollector.mock.calls[0][0].query as string;
		expect(query).toContain("tool_traces");
		expect(query).toContain("uniqExactIf");
		expect(query).toContain("gen_ai.tool.name");
	});

	it("returns unsupported when the source cannot sample traces", async () => {
		mockedResolve.mockResolvedValue({
			isBuiltIn: false,
			type: "tempo",
		} as any);
		const { resolveSignalReadContext } = await import(
			"@/lib/platform/connectors/datasource/facade"
		);
		(resolveSignalReadContext as jest.Mock).mockResolvedValue({
			adapter: {},
			descriptor: { type: "tempo" },
		});
		const result = await getAgentLoop(params);
		expect(result.data?.[0]?.unsupported).toBe(true);
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});
});

describe("summarizeAgentLoopFromSpans", () => {
	it("counts unique traces, not tool spans", () => {
		const row = summarizeAgentLoopFromSpans([
			{
				traceId: "t-1",
				spanAttributes: {
					"gen_ai.tool.name": "search",
					"gen_ai.tool.args": "{}",
				},
			},
			{
				traceId: "t-1",
				spanAttributes: {
					"gen_ai.tool.name": "search",
					"gen_ai.tool.args": "{}",
				},
			},
			{
				traceId: "t-1",
				spanAttributes: {
					"gen_ai.tool.name": "search",
					"gen_ai.tool.args": "{}",
				},
			},
			{
				traceId: "t-2",
				spanAttributes: { "gen_ai.tool.name": "search", "gen_ai.tool.args": "x" },
			},
		]);
		expect(row.tool_traces).toBe(2);
		expect(row.loops).toBe(1);
	});
});
