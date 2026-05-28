import { generateText } from "ai";
import { SERVER_EVENTS } from "@/constants/events";
import getMessage from "@/constants/messages";
import { getDBConfigByUser } from "@/lib/db-config";
import { getChatConfigWithApiKey } from "@/lib/platform/chat/config";
import { saveOtterRun } from "@/lib/platform/chat/otter-runs";
import { getModelInstance } from "@/lib/platform/chat/stream";
import PostHogServer from "@/lib/posthog";
import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";

type PromptImprovementSuggestion = {
	id: string;
	dimension: string;
	rationale: string;
	original: string;
	replacement: string;
};

const MAX_PROMPT_LENGTH = 30000;
const m = getMessage();
const DEFAULT_CRITERIA = [
	m.PROMPT_OTTER_CRITERIA_CONCISE,
	m.PROMPT_OTTER_CRITERIA_STRUCTURE,
	m.PROMPT_OTTER_CRITERIA_VARIABLES,
	m.PROMPT_OTTER_CRITERIA_OUTPUT,
	m.PROMPT_OTTER_CRITERIA_AMBIGUITY,
];

async function getDatabaseConfigId() {
	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	return (dbConfig as any)?.id || "";
}

function stripCodeFence(text: string) {
	return text
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
}

function parseSuggestions(text: string): PromptImprovementSuggestion[] {
	try {
		const parsed = JSON.parse(stripCodeFence(text));
		const suggestions = Array.isArray(parsed) ? parsed : parsed?.suggestions;
		if (!Array.isArray(suggestions)) return [];
		return suggestions
			.map((item: any, index: number) => ({
				id: String(item?.id || `suggestion-${index + 1}`),
				dimension: String(item?.dimension || m.PROMPT_OTTER_DEFAULT_DIMENSION),
				rationale: String(item?.rationale || ""),
				original: String(item?.original || ""),
				replacement: String(item?.replacement || ""),
			}))
			.filter((item) => item.original && item.replacement);
	} catch {
		return [];
	}
}

function estimateCost(promptTokens: number, completionTokens: number) {
	return (promptTokens * 0.003 + completionTokens * 0.015) / 1000;
}

export async function POST(request: Request) {
	const startTimestamp = Date.now();
	const user = await getCurrentUser();
	if (!user) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.PROMPT_IMPROVEMENT_FAILURE,
			startTimestamp,
			properties: { reason: "unauthorized" },
		});
		return Response.json("Unauthorized", { status: 401 });
	}

	const body = await request.json();
	const prompt = String(body?.prompt || "").slice(0, MAX_PROMPT_LENGTH);
	const promptId = String(body?.promptId || "").trim();
	const criteria: string[] = Array.isArray(body?.criteria)
		? body.criteria.map((item: unknown) => String(item).trim()).filter(Boolean)
		: DEFAULT_CRITERIA;

	if (!prompt.trim()) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.PROMPT_IMPROVEMENT_FAILURE,
			startTimestamp,
			properties: { reason: "missing_prompt" },
		});
		return Response.json({ err: m.PROMPT_HUB_CONTENT_REQUIRED }, { status: 400 });
	}

	const databaseConfigId = await getDatabaseConfigId();
	const { data: config, err } = await getChatConfigWithApiKey(databaseConfigId);
	if (err || !config) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.PROMPT_IMPROVEMENT_FAILURE,
			startTimestamp,
			properties: { reason: "missing_config", promptId: promptId || undefined },
		});
		return Response.json(
			{ err: err || m.PROMPT_OTTER_CONFIG_NOT_FOUND },
			{ status: 400 }
		);
	}

	try {
		const model = getModelInstance(config.provider, config.apiKey, config.model);
		let usageStats = { promptTokens: 0, completionTokens: 0, cost: 0 };
		const result = await generateText({
			model,
			temperature: 0,
			system:
				"You are Otter, an expert prompt improvement reviewer. Return JSON only. Do not include markdown.",
			prompt: `Review the prompt and propose precise edits.

Return JSON in this shape:
{
  "suggestions": [
    {
      "id": "short-kebab-id",
      "dimension": "one reviewed dimension",
      "rationale": "why this improves the prompt",
      "original": "exact substring from the prompt",
      "replacement": "replacement text"
    }
  ]
}

Rules:
- Every original value must be an exact substring of the prompt.
- Preserve all template variables exactly, including double braces.
- Prefer small, reviewable changes over a full rewrite.
- Do not invent product behavior or remove required constraints.
- Return at most 8 suggestions.

Improvement criteria:
${criteria.map((item, index) => `${index + 1}. ${item}`).join("\n")}

Prompt:
${prompt}`,
		});
		const promptTokens = result.usage?.inputTokens ?? 0;
		const completionTokens = result.usage?.outputTokens ?? 0;
		usageStats = {
			promptTokens,
			completionTokens,
			cost: estimateCost(promptTokens, completionTokens),
		};

		const suggestions = parseSuggestions(result.text).filter((suggestion) =>
			prompt.includes(suggestion.original)
		);

		await saveOtterRun(
			{
				runType: "prompt_improvement",
				targetType: promptId ? "prompt" : "unsaved_prompt",
				targetId: promptId,
				inputSnapshot: prompt,
				resultJson: JSON.stringify({ suggestions }),
				summary: `${m.PROMPT_OTTER_SUMMARY_PREFIX} ${suggestions.length} ${suggestions.length === 1 ? m.PROMPT_OTTER_SUGGESTION : m.PROMPT_OTTER_SUGGESTIONS}.`,
				modelProvider: config.provider,
				modelName: config.model,
				promptTokens: usageStats.promptTokens,
				completionTokens: usageStats.completionTokens,
				cost: usageStats.cost,
				meta: {
					source: promptId ? "prompt_edit" : "prompt_new",
					criteria,
					suggestionCount: suggestions.length,
				},
			},
			databaseConfigId
		);

		PostHogServer.fireEvent({
			event: SERVER_EVENTS.PROMPT_IMPROVEMENT_SUCCESS,
			startTimestamp,
			properties: {
				promptId: promptId || undefined,
				provider: config.provider,
				model: config.model,
				criteriaCount: criteria.length,
				suggestionCount: suggestions.length,
				promptTokens: usageStats.promptTokens,
				completionTokens: usageStats.completionTokens,
				cost: usageStats.cost,
			},
		});

		return Response.json({
			data: {
				suggestions,
				provider: config.provider,
				model: config.model,
				criteria,
				usage: usageStats,
			},
		});
	} catch (error: any) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.PROMPT_IMPROVEMENT_FAILURE,
			startTimestamp,
			properties: {
				promptId: promptId || undefined,
				error: error?.message || m.PROMPT_OTTER_ANALYSIS_FAILED,
			},
		});
		return Response.json(
			{ err: error?.message || m.PROMPT_OTTER_ANALYSIS_FAILED },
			{ status: 400 }
		);
	}
}
