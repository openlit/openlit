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

	it("has exactly as many entries as EVALUATION_TYPES", () => {
		expect(Object.keys(EVALUATION_TYPE_CONTEXTS).length).toBe(
			EVALUATION_TYPES.length
		);
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

	it("each context starts with the correct [Label evaluation context] header", () => {
		EVALUATION_TYPES.forEach((type) => {
			const ctx = EVALUATION_TYPE_CONTEXTS[type.id];
			expect(ctx.content).toMatch(
				new RegExp(`^\\[${type.label} evaluation context\\]`)
			);
		});
	});

	// Original 6 types
	it("hallucination context mentions factual accuracy", () => {
		expect(EVALUATION_TYPE_CONTEXTS.hallucination.content).toMatch(/factual accuracy/i);
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

	it("faithfulness context mentions source of truth", () => {
		expect(EVALUATION_TYPE_CONTEXTS.faithfulness.content).toMatch(/source of truth/i);
	});

	// New 5 types
	it("safety context mentions jailbreak", () => {
		expect(EVALUATION_TYPE_CONTEXTS.safety.content).toMatch(/jailbreak/i);
	});

	it("instruction_following context mentions instructions", () => {
		expect(EVALUATION_TYPE_CONTEXTS.instruction_following.content).toMatch(/instructions/i);
	});

	it("completeness context mentions all parts", () => {
		expect(EVALUATION_TYPE_CONTEXTS.completeness.content).toMatch(/all parts/i);
	});

	it("conciseness context mentions repetition", () => {
		expect(EVALUATION_TYPE_CONTEXTS.conciseness.content).toMatch(/repetition/i);
	});

	it("sensitivity context mentions PII", () => {
		expect(EVALUATION_TYPE_CONTEXTS.sensitivity.content).toMatch(/PII/i);
	});

	it("context-as-truth types reference provided context", () => {
		const contextTruthTypes = ["hallucination", "relevance", "coherence", "faithfulness"] as const;
		contextTruthTypes.forEach((id) => {
			expect(EVALUATION_TYPE_CONTEXTS[id].content).toMatch(/provided context/i);
		});
	});
});
