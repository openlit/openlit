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
	getGenerationHealth,
	summarizeGenerationHealthFromSpans,
} from "@/lib/platform/llm/generation-health";
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

describe("getGenerationHealth", () => {
	beforeEach(() => {
		mockedDataCollector.mockReset();
		mockedResolve.mockResolvedValue({
			isBuiltIn: true,
			type: "clickhouse",
		} as any);
	});

	it("computes percents against the eligible set, not all LLM spans", async () => {
		mockedDataCollector.mockResolvedValue({
			data: [
				{
					llm_spans: 100,
					finish_eligible: 40,
					truncated: 10,
					filtered: 2,
					empty_eligible: 80,
					empty: 4,
					swap_eligible: 20,
					swapped: 5,
					previous_llm_spans: 100,
					previous_finish_eligible: 40,
					previous_truncated: 8,
					previous_filtered: 2,
					previous_empty_eligible: 80,
					previous_empty: 4,
					previous_swap_eligible: 20,
					previous_swapped: 5,
				},
			],
		});

		const result = await getGenerationHealth(params);
		const row = result.data?.[0];
		expect(row?.llm_spans).toBe(100);
		expect(row?.truncated).toBe(10);
		expect(row?.truncated_eligible).toBe(40);
		expect(row?.truncated_pct).toBe(25);
		expect(row?.swapped_pct).toBe(25);
		expect(row?.empty_pct).toBe(5);
		const query = mockedDataCollector.mock.calls[0][0].query as string;
		expect(query).toContain("finish_eligible");
		expect(query).toContain("swap_eligible");
		expect(query).toContain("empty_eligible");
		expect(query).toContain("countIf");
		expect(query).not.toContain("operationType");
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
		const result = await getGenerationHealth(params);
		expect(result.data?.[0]?.unsupported).toBe(true);
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});

	it("classifies sampled spans for any traces adapter with sampleTracesForGraph", async () => {
		mockedResolve.mockResolvedValue({
			isBuiltIn: false,
			type: "tempo",
		} as any);
		const { resolveSignalReadContext } = await import(
			"@/lib/platform/connectors/datasource/facade"
		);
		const { metricParamsToOpenLITQuery } = await import(
			"@/lib/platform/connectors/datasource/clickhouse/query-map"
		);
		const sampleTracesForGraph = jest.fn(async () => [
			{
				traceId: "t-trunc",
				spanAttributes: {
					"gen_ai.response.finish_reasons": "length",
					"gen_ai.usage.output_tokens": "12",
					"gen_ai.request.model": "gpt-4o",
					"gen_ai.response.model": "gpt-4o",
				},
			},
			{
				traceId: "t-swap",
				spanAttributes: {
					"gen_ai.response.finish_reasons": "stop",
					"gen_ai.usage.output_tokens": "8",
					"gen_ai.request.model": "gpt-4o",
					"gen_ai.response.model": "gpt-4o-mini",
				},
			},
		]);
		(resolveSignalReadContext as jest.Mock).mockResolvedValue({
			adapter: { sampleTracesForGraph },
			descriptor: { type: "tempo" },
		});
		const result = await getGenerationHealth(params);
		const row = result.data?.[0];
		expect(row?.unsupported).toBeFalsy();
		expect(row?.llm_spans).toBe(2);
		expect(row?.truncated).toBe(1);
		expect(row?.swapped).toBe(1);
		expect(mockedDataCollector).not.toHaveBeenCalled();
		expect(sampleTracesForGraph).toHaveBeenCalledWith(expect.anything(), 200);
		expect(metricParamsToOpenLITQuery).toHaveBeenCalledWith(
			expect.anything(),
			"traces"
		);
	});
});

describe("summarizeGenerationHealthFromSpans", () => {
	it("counts one row per trace so child LLM spans do not inflate chips", () => {
		const row = summarizeGenerationHealthFromSpans([
			{
				traceId: "t-1",
				spanAttributes: { "http.method": "GET" },
			},
			{
				traceId: "t-1",
				spanAttributes: {
					"gen_ai.request.model": "gpt-4o",
					"gen_ai.response.model": "gpt-4o-mini",
				},
			},
			{
				traceId: "t-1",
				spanAttributes: {
					"gen_ai.response.finish_reasons": "length",
					"gen_ai.request.model": "gpt-4o",
					"gen_ai.response.model": "gpt-4o",
				},
			},
		]);
		expect(row.llm_spans).toBe(1);
		expect(row.swapped).toBe(1);
		expect(row.truncated).toBe(1);
		expect(row.swapped_eligible).toBe(1);
	});
});
