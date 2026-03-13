import { EVALUATION_TYPE_CONTEXTS } from "@/constants/evaluation-type-contexts";
import { EVALUATION_TYPES } from "@/constants/evaluation-types";

describe("EVALUATION_TYPE_CONTEXTS", () => {
	it("is an object", () => {
		expect(typeof EVALUATION_TYPE_CONTEXTS).toBe("object");
		expect(EVALUATION_TYPE_CONTEXTS).not.toBeNull();
	});

	it("has a context entry for every evaluation type", () => {
		EVALUATION_TYPES.forEach((type) => {
			expect(EVALUATION_TYPE_CONTEXTS).toHaveProperty(type.id);
		});
	});

	it("each context has enabled boolean and non-empty content string", () => {
		Object.values(EVALUATION_TYPE_CONTEXTS).forEach((ctx) => {
			expect(typeof ctx.enabled).toBe("boolean");
			expect(typeof ctx.content).toBe("string");
			expect(ctx.content.length).toBeGreaterThan(0);
		});
	});

	it("all contexts are enabled by default", () => {
		Object.values(EVALUATION_TYPE_CONTEXTS).forEach((ctx) => {
			expect(ctx.enabled).toBe(true);
		});
	});

	it("hallucination context mentions factual accuracy", () => {
		expect(EVALUATION_TYPE_CONTEXTS.hallucination.content).toMatch(
			/factual accuracy/i
		);
	});

	it("bias context mentions gender", () => {
		expect(EVALUATION_TYPE_CONTEXTS.bias.content).toMatch(/gender/i);
	});

	it("toxicity context mentions harmful", () => {
		expect(EVALUATION_TYPE_CONTEXTS.toxicity.content).toMatch(/harmful/i);
	});

	it("relevance context mentions prompt", () => {
		expect(EVALUATION_TYPE_CONTEXTS.relevance.content).toMatch(/prompt/i);
	});

	it("coherence context mentions logical flow", () => {
		expect(EVALUATION_TYPE_CONTEXTS.coherence.content).toMatch(/logical flow/i);
	});

	it("faithfulness context mentions alignment", () => {
		expect(EVALUATION_TYPE_CONTEXTS.faithfulness.content).toMatch(/alignment/i);
	});

	it("has exactly as many entries as EVALUATION_TYPES", () => {
		expect(Object.keys(EVALUATION_TYPE_CONTEXTS).length).toBe(
			EVALUATION_TYPES.length
		);
	});
});
