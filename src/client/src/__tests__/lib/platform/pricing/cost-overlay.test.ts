const mockDataCollector = jest.fn();

jest.mock("@/lib/platform/common", () => ({
	dataCollector: (...args: unknown[]) => mockDataCollector(...args),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
}));

import {
	applyCostOverlayToSpans,
	getCostOverlay,
	OPENLIT_COST_OVERLAY_TABLE,
	upsertCostOverlays,
	withCostOverlay,
} from "@/lib/platform/pricing/cost-overlay";
import type { NormalizedSpan } from "@/lib/platform/datasource/types";

const span = (spanId: string, cost?: number): NormalizedSpan => ({
	traceId: "t",
	spanId,
	parentSpanId: "",
	name: "chat",
	serviceName: "svc",
	timestamp: "2026-07-01T00:00:00Z",
	durationNs: 0,
	statusCode: "OK",
	spanAttributes: cost !== undefined ? { "gen_ai.usage.cost": String(cost) } : {},
	resourceAttributes: {},
	cost,
});

beforeEach(() => {
	jest.clearAllMocks();
});

describe("cost overlay", () => {
	describe("upsertCostOverlays", () => {
		it("no-ops without a source or entries", async () => {
			expect(await upsertCostOverlays("", [{ spanId: "s1", cost: 1 }])).toEqual({});
			expect(await upsertCostOverlays("src", [])).toEqual({});
			expect(mockDataCollector).not.toHaveBeenCalled();
		});

		it("inserts overlay rows for a source", async () => {
			mockDataCollector.mockResolvedValue({ data: {} });
			await upsertCostOverlays(
				"src-1",
				[
					{ spanId: "s1", cost: 0.25, model: "gpt-4" },
					{ spanId: "", cost: 9 },
				],
				"db-1"
			);
			const [args, type, dbId] = mockDataCollector.mock.calls[0];
			expect(type).toBe("insert");
			expect(dbId).toBe("db-1");
			expect((args as { table: string }).table).toBe(OPENLIT_COST_OVERLAY_TABLE);
			// The empty-spanId entry is filtered out.
			expect((args as { values: unknown[] }).values).toEqual([
				{ source_id: "src-1", span_id: "s1", cost_usd: 0.25, model: "gpt-4" },
			]);
		});
	});

	describe("getCostOverlay", () => {
		it("returns an empty map without source or ids", async () => {
			expect((await getCostOverlay("", ["s1"])).size).toBe(0);
			expect((await getCostOverlay("src", [])).size).toBe(0);
			expect(mockDataCollector).not.toHaveBeenCalled();
		});

		it("queries FINAL and returns a spanId->cost map", async () => {
			mockDataCollector.mockResolvedValue({
				data: [
					{ span_id: "s1", cost_usd: 0.25 },
					{ span_id: "s2", cost_usd: 1.5 },
				],
			});
			const map = await getCostOverlay("src-1", ["s1", "s2", "s1"], "db-1");
			expect(map.get("s1")).toBe(0.25);
			expect(map.get("s2")).toBe(1.5);
			const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
			expect(sql).toContain("FINAL");
			expect(sql).toContain("source_id = 'src-1'");
			expect(sql).toContain("span_id IN ('s1', 's2')");
		});
	});

	describe("applyCostOverlayToSpans", () => {
		it("returns spans unchanged when overlay is empty", () => {
			const spans = [span("s1", 1)];
			expect(applyCostOverlayToSpans(spans, new Map())).toBe(spans);
		});

		it("applies overlay cost onto matching spans only", () => {
			const spans = [span("s1", 1), span("s2")];
			const result = applyCostOverlayToSpans(
				spans,
				new Map([["s1", 0.99]])
			);
			expect(result[0].cost).toBe(0.99);
			expect(result[0].spanAttributes["gen_ai.usage.cost"]).toBe("0.99");
			// s2 untouched
			expect(result[1]).toBe(spans[1]);
		});
	});

	describe("withCostOverlay", () => {
		it("fetches and applies the overlay in one call", async () => {
			mockDataCollector.mockResolvedValue({
				data: [{ span_id: "s1", cost_usd: 2 }],
			});
			const result = await withCostOverlay("src-1", [span("s1"), span("s2")]);
			expect(result[0].cost).toBe(2);
			expect(result[1].cost).toBeUndefined();
		});
	});
});
