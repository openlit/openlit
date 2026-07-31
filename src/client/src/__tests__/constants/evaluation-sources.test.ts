import {
	AUTO_EVALUATION_HANDLED_SOURCES,
	EVALUATION_SOURCE,
	isAutoEvaluationHandledSource,
} from "@/constants/evaluation-sources";

describe("evaluation-sources", () => {
	it("recognizes auto-handled sources and rejects others", () => {
		expect(isAutoEvaluationHandledSource(EVALUATION_SOURCE.AUTO)).toBe(true);
		expect(isAutoEvaluationHandledSource(EVALUATION_SOURCE.AUTO_SKIPPED)).toBe(
			true
		);
		expect(isAutoEvaluationHandledSource(EVALUATION_SOURCE.MANUAL)).toBe(false);
		expect(isAutoEvaluationHandledSource(EVALUATION_SOURCE.MANUAL_FEEDBACK)).toBe(
			false
		);
		expect(isAutoEvaluationHandledSource(null)).toBe(false);
		expect(isAutoEvaluationHandledSource(undefined)).toBe(false);
		expect(isAutoEvaluationHandledSource("")).toBe(false);
		expect(AUTO_EVALUATION_HANDLED_SOURCES).toEqual([
			EVALUATION_SOURCE.AUTO,
			EVALUATION_SOURCE.AUTO_SKIPPED,
		]);
	});
});
