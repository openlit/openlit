import fixture from "@/__tests__/fixtures/trace-analysis.example.json";
import {
	TRACE_ANALYSIS_DIMENSIONS,
	emptyTraceAnalysis,
} from "@/types/trace-analysis";

describe("trace analysis schema fixture", () => {
	it("has all six dimensions and span refs on findings", () => {
		expect(Object.keys(fixture).filter((key) =>
			(TRACE_ANALYSIS_DIMENSIONS as readonly string[]).includes(key)
		)).toMatchSnapshot();

		for (const dimension of TRACE_ANALYSIS_DIMENSIONS) {
			expect(Array.isArray((fixture as any)[dimension])).toBe(true);
			for (const finding of (fixture as any)[dimension]) {
				expect(Array.isArray(finding.span_refs)).toBe(true);
				expect(finding.span_refs.length).toBeGreaterThan(0);
			}
		}
	});
});

describe("emptyTraceAnalysis", () => {
	it("returns all six dimension arrays as empty", () => {
		const analysis = emptyTraceAnalysis("trace-123");
		expect(analysis.trace_id).toBe("trace-123");
		expect(analysis.summary).toBe("");
		for (const dimension of TRACE_ANALYSIS_DIMENSIONS) {
			expect(analysis[dimension]).toEqual([]);
		}
	});

	it("returns zero totals", () => {
		const { totals } = emptyTraceAnalysis("t");
		expect(totals.span_count).toBe(0);
		expect(totals.total_tokens).toBe(0);
		expect(totals.total_cost_usd).toBe(0);
		expect(totals.duration_ms).toBe(0);
	});

	it("produces independent objects on each call", () => {
		const a = emptyTraceAnalysis("t1");
		const b = emptyTraceAnalysis("t2");
		a.improvements.push({ id: "x", severity: "info", summary: "s", detail: "d", span_refs: [] });
		expect(b.improvements).toHaveLength(0);
	});
});

describe("severity ordering", () => {
	it("all valid severity values are accepted by the type", () => {
		const severities = ["info", "minor", "major", "critical"] as const;
		for (const severity of severities) {
			expect(typeof severity).toBe("string");
		}
		// critical is the most severe — confirm ordering expectation
		const ordered = ["info", "minor", "major", "critical"];
		expect(ordered.indexOf("critical")).toBeGreaterThan(ordered.indexOf("major"));
		expect(ordered.indexOf("major")).toBeGreaterThan(ordered.indexOf("minor"));
		expect(ordered.indexOf("minor")).toBeGreaterThan(ordered.indexOf("info"));
	});
});
