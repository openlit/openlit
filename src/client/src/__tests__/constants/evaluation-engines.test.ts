import {
	EVALUATION_ENGINES,
	type EvaluationEngineId,
} from "@/constants/evaluation-engines";

describe("EVALUATION_ENGINES", () => {
	it("is an array", () => {
		expect(Array.isArray(EVALUATION_ENGINES)).toBe(true);
	});

	it("has at least one engine", () => {
		expect(EVALUATION_ENGINES.length).toBeGreaterThan(0);
	});

	it("contains vercel engine", () => {
		const ids = EVALUATION_ENGINES.map((e) => e.id);
		expect(ids).toContain("vercel");
	});

	it("each engine has required fields", () => {
		EVALUATION_ENGINES.forEach((engine) => {
			expect(typeof engine.id).toBe("string");
			expect(engine.id.length).toBeGreaterThan(0);
			expect(typeof engine.label).toBe("string");
			expect(engine.label.length).toBeGreaterThan(0);
			expect(typeof engine.description).toBe("string");
			expect(engine.description.length).toBeGreaterThan(0);
			expect(typeof engine.requiresModel).toBe("boolean");
			expect(typeof engine.requiresApiKey).toBe("boolean");
		});
	});

	it("vercel engine requires model and api key", () => {
		const vercel = EVALUATION_ENGINES.find((e) => e.id === "vercel");
		expect(vercel).toBeDefined();
		expect(vercel!.requiresModel).toBe(true);
		expect(vercel!.requiresApiKey).toBe(true);
	});

	it("vercel engine has correct label", () => {
		const vercel = EVALUATION_ENGINES.find((e) => e.id === "vercel");
		expect(vercel!.label).toBe("Vercel AI SDK");
	});

	it("all engine ids are unique", () => {
		const ids = EVALUATION_ENGINES.map((e) => e.id);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});
});

describe("EvaluationEngineId type", () => {
	it("vercel is a valid EvaluationEngineId", () => {
		const id: EvaluationEngineId = "vercel";
		expect(id).toBe("vercel");
	});
});
