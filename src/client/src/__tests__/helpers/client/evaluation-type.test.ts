import {
	displayEvaluationTypeName,
	normalizeEvaluationStoredName,
	resolveEvaluationType,
} from "@/helpers/client/evaluation-type";

describe("evaluation-type resolve", () => {
	it("resolves built-in ids and labels", () => {
		expect(resolveEvaluationType("hallucination")).toEqual({
			id: "hallucination",
			label: "Hallucination",
		});
		expect(resolveEvaluationType("Hallucination")).toEqual({
			id: "hallucination",
			label: "Hallucination",
		});
	});

	it("strips evaluation context suffix from stored names", () => {
		expect(normalizeEvaluationStoredName("Bias evaluation context")).toBe(
			"Bias"
		);
		expect(resolveEvaluationType("Toxicity evaluation context")).toEqual({
			id: "toxicity",
			label: "Toxicity",
		});
	});

	it("resolves custom types by id or label", () => {
		const custom = [{ id: "clarity_eval", label: "Clarity Evaluation" }];
		expect(resolveEvaluationType("Clarity Evaluation", custom)).toEqual({
			id: "clarity_eval",
			label: "Clarity Evaluation",
		});
		expect(resolveEvaluationType("clarity_eval", custom)?.id).toBe(
			"clarity_eval"
		);
	});

	it("returns null for unknown names", () => {
		expect(resolveEvaluationType("TypeA")).toBeNull();
	});

	it("formats display names for unresolved values", () => {
		expect(displayEvaluationTypeName("TypeA")).toBe("TypeA");
		expect(displayEvaluationTypeName("factual_accuracy")).toBe(
			"Factual Accuracy"
		);
		expect(displayEvaluationTypeName("Hallucination evaluation context")).toBe(
			"Hallucination"
		);
	});
});
