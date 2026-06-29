import {
	normalizeEvalSampleRate,
	shouldAutoEvaluateSpan,
} from "@/lib/platform/evaluation/sampling";

describe("normalizeEvalSampleRate", () => {
	it("defaults to 1 when value is missing", () => {
		expect(normalizeEvalSampleRate(undefined)).toBe(1);
		expect(normalizeEvalSampleRate(null)).toBe(1);
		expect(normalizeEvalSampleRate("")).toBe(1);
	});

	it("clamps values to the 0-1 range", () => {
		expect(normalizeEvalSampleRate(0)).toBe(0);
		expect(normalizeEvalSampleRate(-0.5)).toBe(0);
		expect(normalizeEvalSampleRate(1)).toBe(1);
		expect(normalizeEvalSampleRate(2)).toBe(1);
		expect(normalizeEvalSampleRate(0.25)).toBe(0.25);
	});

	it("returns NaN for invalid values", () => {
		expect(Number.isNaN(normalizeEvalSampleRate("invalid"))).toBe(true);
		expect(Number.isNaN(normalizeEvalSampleRate(Number.NaN))).toBe(true);
	});
});

describe("shouldAutoEvaluateSpan", () => {
	it("always evaluates when sample rate is 1", () => {
		expect(shouldAutoEvaluateSpan("span-a", 1)).toBe(true);
		expect(shouldAutoEvaluateSpan("span-b", 1.5)).toBe(true);
	});

	it("never evaluates when sample rate is 0", () => {
		expect(shouldAutoEvaluateSpan("span-a", 0)).toBe(false);
		expect(shouldAutoEvaluateSpan("span-b", -0.1)).toBe(false);
	});

	it("returns a stable decision for the same span id", () => {
		const first = shouldAutoEvaluateSpan("stable-span-id", 0.5);
		const second = shouldAutoEvaluateSpan("stable-span-id", 0.5);
		expect(first).toBe(second);
	});

	it("samples roughly the requested percentage", () => {
		const spanIds = Array.from({ length: 1000 }, (_, index) => `span-${index}`);
		const sampleRate = 0.2;
		const sampledCount = spanIds.filter((spanId) =>
			shouldAutoEvaluateSpan(spanId, sampleRate)
		).length;

		expect(sampledCount).toBeGreaterThan(120);
		expect(sampledCount).toBeLessThan(280);
	});
});
