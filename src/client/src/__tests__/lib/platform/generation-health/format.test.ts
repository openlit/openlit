import {
	asFiniteNumber,
	fillTemplate,
	generationHealthCountLine,
	generationHealthSkippedLine,
	generationHealthTipMeaning,
} from "@/lib/platform/generation-health/format";

describe("generation health copy", () => {
	it("explains each chip in plain language", () => {
		expect(generationHealthTipMeaning("truncated")).toMatch(/token limit/i);
		expect(generationHealthTipMeaning("filtered")).toMatch(/safety filter/i);
		expect(generationHealthTipMeaning("empty")).toMatch(/no completion tokens/i);
		expect(generationHealthTipMeaning("swapped")).toMatch(/different model/i);
	});

	it("shows count over eligible on the face of the UI", () => {
		expect(
			fillTemplate("{count}/{eligible}", { count: 24, eligible: 193 })
		).toBe("24/193");
		expect(generationHealthCountLine(24, 193)).toBe(
			"24 of 193 traces in this window"
		);
		expect(generationHealthCountLine(0, 20)).toBe(
			"None of 20 traces in this window"
		);
		expect(generationHealthCountLine(0, 0)).toMatch(/attributes needed/i);
	});

	it("explains skipped spans only when some were ineligible", () => {
		expect(generationHealthSkippedLine(0, 100)).toBeNull();
		expect(generationHealthSkippedLine(60, 100)).toContain("60 of 100");
	});

	it("renders 0 instead of NaN for ClickHouse nan / missing metrics", () => {
		expect(asFiniteNumber("nan")).toBe(0);
		expect(asFiniteNumber(Number.NaN)).toBe(0);
		expect(asFiniteNumber(Infinity)).toBe(0);
		expect(fillTemplate("{count}/{eligible}", { count: NaN, eligible: 12 })).toBe(
			"0/12"
		);
		expect(generationHealthCountLine(NaN, NaN)).toMatch(/attributes needed/i);
		expect(generationHealthCountLine(NaN, 20)).toBe(
			"None of 20 traces in this window"
		);
		expect(generationHealthSkippedLine(NaN, 100)).toBeNull();
	});
});
