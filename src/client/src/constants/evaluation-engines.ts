/**
 * Supported evaluation engines. Each engine has different capabilities
 * and configuration requirements.
 */
export const EVALUATION_ENGINES = [
	{
		id: "vercel",
		label: "Vercel AI SDK",
		description:
			"LLM-based evaluation using Vercel AI SDK. Supports OpenAI, Anthropic, and other providers. Evaluates Hallucination, Bias, Toxicity.",
		requiresModel: true,
		requiresApiKey: true,
	},
] as const;

export type EvaluationEngineId = (typeof EVALUATION_ENGINES)[number]["id"];
