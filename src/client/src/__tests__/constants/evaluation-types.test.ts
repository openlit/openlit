import {
	EVALUATION_TYPES,
	type EvaluationTypeId,
} from "@/constants/evaluation-types";

describe("EVALUATION_TYPES", () => {
	it("is an array", () => {
		expect(Array.isArray(EVALUATION_TYPES)).toBe(true);
	});

	it("has at least one type", () => {
		expect(EVALUATION_TYPES.length).toBeGreaterThan(0);
	});

	it("contains all expected evaluation type ids", () => {
		const ids = EVALUATION_TYPES.map((t) => t.id);
		expect(ids).toContain("hallucination");
		expect(ids).toContain("bias");
		expect(ids).toContain("toxicity");
		expect(ids).toContain("relevance");
		expect(ids).toContain("coherence");
		expect(ids).toContain("faithfulness");
	});

	it("each type has required fields", () => {
		EVALUATION_TYPES.forEach((type) => {
			expect(typeof type.id).toBe("string");
			expect(type.id.length).toBeGreaterThan(0);
			expect(typeof type.label).toBe("string");
			expect(type.label.length).toBeGreaterThan(0);
			expect(typeof type.description).toBe("string");
			expect(type.description.length).toBeGreaterThan(0);
			expect(typeof type.enabledByDefault).toBe("boolean");
		});
	});

	it("hallucination, bias, and toxicity are enabled by default", () => {
		const defaultEnabled = EVALUATION_TYPES.filter((t) => t.enabledByDefault).map(
			(t) => t.id
		);
		expect(defaultEnabled).toContain("hallucination");
		expect(defaultEnabled).toContain("bias");
		expect(defaultEnabled).toContain("toxicity");
	});

	it("relevance, coherence, and faithfulness are disabled by default", () => {
		const defaultDisabled = EVALUATION_TYPES.filter(
			(t) => !t.enabledByDefault
		).map((t) => t.id);
		expect(defaultDisabled).toContain("relevance");
		expect(defaultDisabled).toContain("coherence");
		expect(defaultDisabled).toContain("faithfulness");
	});

	it("all type ids are unique", () => {
		const ids = EVALUATION_TYPES.map((t) => t.id);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});
});

describe("EvaluationTypeId type", () => {
	it("known ids are valid EvaluationTypeId values", () => {
		const ids: EvaluationTypeId[] = [
			"hallucination",
			"bias",
			"toxicity",
			"relevance",
			"coherence",
			"faithfulness",
		];
		expect(ids).toHaveLength(6);
	});
});
