/**
 * Supported evaluation types. Users can enable/disable each type and link
 * rules to provide context via the Rule Engine.
 *
 * To add a new evaluation type:
 * 1. Add entry here with id, label, description, enabledByDefault
 * 2. Add prebuilt default prompt in create-evaluation-type-defaults-migration.ts (DEFAULT_PROMPTS)
 */
export const EVALUATION_TYPES = [
	{
		id: "hallucination",
		label: "Hallucination",
		description:
			"Detects factual inaccuracies, contradictions, and nonsensical responses.",
		enabledByDefault: true,
	},
	{
		id: "bias",
		label: "Bias",
		description:
			"Detects prejudiced or biased language across categories like gender, ethnicity, age.",
		enabledByDefault: true,
	},
	{
		id: "toxicity",
		label: "Toxicity",
		description:
			"Detects harmful, offensive, or toxic language including threats and hate speech.",
		enabledByDefault: true,
	},
	{
		id: "relevance",
		label: "Relevance",
		description: "Evaluates how well the response addresses the prompt.",
		enabledByDefault: false,
	},
	{
		id: "coherence",
		label: "Coherence",
		description: "Assesses logical flow and consistency of the response.",
		enabledByDefault: false,
	},
	{
		id: "faithfulness",
		label: "Faithfulness",
		description: "Measures alignment with provided context or source material.",
		enabledByDefault: false,
	},
] as const;

export type EvaluationTypeId = (typeof EVALUATION_TYPES)[number]["id"];
