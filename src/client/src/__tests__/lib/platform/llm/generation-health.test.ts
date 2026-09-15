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
import { UnsupportedCapabilityError } from "@/lib/platform/connectors/datasource/types";

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
			dbConfigId: "db-dev",
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

		const result = await getGenerationHealth({
			...params,
			environment: "dev",
		});
		const row = result.data?.[0];
		expect(row?.llm_spans).toBe(100);
		expect(row?.truncated).toBe(10);
		expect(row?.truncated_eligible).toBe(40);
		expect(row?.truncated_pct).toBe(25);
		expect(row?.swapped_pct).toBe(25);
		expect(row?.empty_pct).toBe(5);
		expect(mockedResolve).toHaveBeenCalledWith({
			signal: "traces",
			sourceId: undefined,
			environment: "dev",
		});
		expect(mockedDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({ query: expect.any(String) }),
			"query",
			"db-dev"
		);
		const query = mockedDataCollector.mock.calls[0][0].query as string;
		expect(query).toContain("finish_eligible");
		expect(query).toContain("swap_eligible");
		expect(query).toContain("empty_eligible");
		expect(query).toContain("uniqExactIf");
		expect(query).toContain("TraceId");
		expect(query).not.toContain("countIf");
		expect(query).not.toContain("operationType");
	});

	it("defaults to an empty row when dataCollector returns no rows", async () => {
		mockedDataCollector.mockResolvedValue({ data: undefined });

		const result = await getGenerationHealth(params);

		expect(result.err).toBeUndefined();
		expect(result.data?.[0]?.llm_spans).toBe(0);
	});

	it("returns the ClickHouse dataCollector error", async () => {
		mockedDataCollector.mockResolvedValue({ err: "query failed", data: [] });

		const result = await getGenerationHealth(params);

		expect(result.err).toBe("query failed");
		expect(result.data).toEqual([]);
	});

	it("prefers an explicit databaseConfigId over the resolved traces binding", async () => {
		mockedResolve.mockResolvedValue({
			isBuiltIn: true,
			type: "clickhouse",
			dbConfigId: "db-from-environment",
		} as any);
		mockedDataCollector.mockResolvedValue({ data: [{}] });

		await getGenerationHealth({
			...params,
			environment: "dev",
			databaseConfigId: "db-explicit",
		});

		expect(mockedDataCollector).toHaveBeenCalledWith(
			expect.anything(),
			"query",
			"db-explicit"
		);
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

	it("returns unsupported when sampling raises UnsupportedCapabilityError", async () => {
		mockedResolve.mockResolvedValue({
			isBuiltIn: false,
			type: "tempo",
		} as any);
		const { resolveSignalReadContext } = await import(
			"@/lib/platform/connectors/datasource/facade"
		);
		const sampleTracesForGraph = jest.fn(async () => {
			throw new UnsupportedCapabilityError("tempo", "sampleTracesForGraph");
		});
		(resolveSignalReadContext as jest.Mock).mockResolvedValue({
			adapter: { sampleTracesForGraph },
			descriptor: { type: "tempo" },
		});

		const result = await getGenerationHealth(params);

		expect(result.data?.[0]?.unsupported).toBe(true);
		expect(result.err).toBeUndefined();
	});

	it("surfaces other sampling errors instead of swallowing them", async () => {
		mockedResolve.mockResolvedValue({
			isBuiltIn: false,
			type: "tempo",
		} as any);
		const { resolveSignalReadContext } = await import(
			"@/lib/platform/connectors/datasource/facade"
		);
		const sampleTracesForGraph = jest.fn(async () => {
			throw new Error("adapter exploded");
		});
		(resolveSignalReadContext as jest.Mock).mockResolvedValue({
			adapter: { sampleTracesForGraph },
			descriptor: { type: "tempo" },
		});

		const result = await getGenerationHealth(params);

		expect(result.data).toEqual([]);
		expect((result.err as Error)?.message).toBe("adapter exploded");
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

	it("counts filtered and empty chips when a trace matches them", () => {
		const row = summarizeGenerationHealthFromSpans([
			{
				traceId: "t-filtered",
				spanAttributes: {
					"gen_ai.response.finish_reasons": "content_filter",
					"gen_ai.request.model": "gpt-4o",
				},
			},
			{
				traceId: "t-empty",
				spanAttributes: {
					"gen_ai.response.finish_reasons": "stop",
					"gen_ai.usage.output_tokens": "0",
				},
			},
		]);
		expect(row.llm_spans).toBe(2);
		expect(row.filtered).toBe(1);
		expect(row.empty).toBe(1);
	});

	it("ignores spans from non-LLM traces entirely", () => {
		const row = summarizeGenerationHealthFromSpans([
			{ traceId: "t-plain", spanAttributes: { "http.method": "GET" } },
		]);
		expect(row.llm_spans).toBe(0);
		expect(row.truncated).toBe(0);
	});

	it("handles spans with neither spanAttributes nor a traceId", () => {
		const row = summarizeGenerationHealthFromSpans([
			{ resourceAttributes: { "gen_ai.operation.name": "chat" } },
		]);
		expect(row.llm_spans).toBe(1);
	});
});
