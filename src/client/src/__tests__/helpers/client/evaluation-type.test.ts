import {
	displayEvaluationTypeName,
	getEvaluationStoredNameVariants,
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

	it("resolves a built-in type by its multi-word label when the id uses underscores", () => {
		expect(resolveEvaluationType("Instruction Following")).toEqual({
			id: "instruction_following",
			label: "Instruction Following",
		});
	});

	it("falls back to a formatted label when a custom type matched by id has no label", () => {
		const custom = [{ id: "no_label_type", label: "" }];
		expect(resolveEvaluationType("no_label_type", custom)).toEqual({
			id: "no_label_type",
			label: "No Label Type",
		});
	});

	it("matches a custom type by its compact label even when its label is empty", () => {
		const custom = [{ id: "weird", label: "" }];
		expect(resolveEvaluationType("___", custom)).toEqual({
			id: "weird",
			label: "Weird",
		});
	});

	it("resolves an empty stored value to an empty display name", () => {
		expect(resolveEvaluationType("")).toBeNull();
		expect(displayEvaluationTypeName("")).toBe("");
	});
});

describe("getEvaluationStoredNameVariants", () => {
	it("uses the provided label to build stored-name variants", () => {
		const variants = getEvaluationStoredNameVariants("custom_id", "Custom Label");
		expect(variants).toEqual([
			"custom_id",
			"Custom Label",
			"Custom Label evaluation context",
			"custom_id evaluation context",
		]);
	});

	it("looks up the built-in label when none is provided", () => {
		const variants = getEvaluationStoredNameVariants("hallucination");
		expect(variants).toEqual(
			expect.arrayContaining([
				"hallucination",
				"Hallucination",
				"Hallucination evaluation context",
			])
		);
	});

	it("falls back to the id when no label is provided and no built-in type matches", () => {
		const variants = getEvaluationStoredNameVariants("custom_unmatched_id");
		expect(variants).toEqual([
			"custom_unmatched_id",
			"custom_unmatched_id evaluation context",
		]);
	});
});
