/**
 * Native TypeSafe System One transport for OpenLIT evaluations.
 * Does not use Vercel AI SDK `generateText` or `@typesafe-ai/sdk`.
 */
import { Evaluation } from "@/types/evaluation";
import {
	buildSystemOneRequest,
	mapSystemOneAnswers,
	TYPESAFE_DEFAULT_MODEL,
	type EvaluationTypeForJev,
	type SystemOneResponseBody,
} from "./jev-mapper";
import type { RunEvaluationResult } from "./run-evaluation";

const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";
const RETRY_STATUSES = new Set([429, 529]);
const MAX_ATTEMPTS = 3;

const DEFAULT_RESULT: Evaluation[] = [
	{ score: 0, evaluation: "Hallucination", classification: "none", explanation: "No Hallucination detected", verdict: "no" },
	{ score: 0, evaluation: "Bias", classification: "none", explanation: "No Bias is detected", verdict: "no" },
	{ score: 0, evaluation: "Toxicity", classification: "none", explanation: "No Toxicity is detected", verdict: "no" },
];

export type RunJevEvaluationParams = {
	apiKey: string;
	model: string;
	prompt?: string;
	contexts?: string;
	response?: string;
	thresholdScore?: number;
	evaluationTypes?: EvaluationTypeForJev[];
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postSystemOne(
	apiKey: string,
	body: unknown
): Promise<{ ok: true; data: SystemOneResponseBody } | { ok: false; error: string }> {
	let lastError = "TypeSafe System One request failed";
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const res = await fetch(SYSTEM_ONE_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
			await sleep(500 * 2 ** attempt);
			continue;
		}

		const text = await res.text();
		if (!res.ok) {
			lastError = `TypeSafe System One returned ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
			if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
				continue;
			}
			return { ok: false, error: lastError };
		}

		try {
			return { ok: true, data: JSON.parse(text) as SystemOneResponseBody };
		} catch {
			return { ok: false, error: "TypeSafe System One returned invalid JSON" };
		}
	}
	return { ok: false, error: lastError };
}

export async function runJevEvaluation(
	params: RunJevEvaluationParams
): Promise<RunEvaluationResult> {
	const {
		apiKey,
		model,
		prompt = "",
		contexts = "",
		response = "",
		thresholdScore = 0.5,
		evaluationTypes,
	} = params;

	if (!apiKey || !model) {
		return {
			success: false,
			result: DEFAULT_RESULT,
			error: "Missing apiKey, provider, or model",
		};
	}

	const request = buildSystemOneRequest({
		prompt,
		response,
		groundTruthContext: contexts,
		model: model || TYPESAFE_DEFAULT_MODEL,
		evaluationTypes,
	});

	try {
		const posted = await postSystemOne(apiKey, request);
		if (!posted.ok) {
			return { success: false, result: DEFAULT_RESULT, error: posted.error };
		}

		const mapped = mapSystemOneAnswers({
			types: evaluationTypes,
			answers: posted.data.answers,
			thresholdScore,
			resolvedModel: posted.data.model,
		});

		if (!mapped.evaluations.length) {
			return {
				success: false,
				result: DEFAULT_RESULT,
				error: "Invalid response format",
			};
		}

		const inputTokens = posted.data.usage?.input_tokens;
		const outputTokens = posted.data.usage?.output_tokens;
		const usage =
			inputTokens != null && outputTokens != null
				? { promptTokens: inputTokens, completionTokens: outputTokens }
				: undefined;

		return {
			success: true,
			result: mapped.evaluations,
			usage,
			extraMeta: mapped.extraMeta,
		};
	} catch (e) {
		const err = e instanceof Error ? e.message : String(e);
		return {
			success: false,
			result: DEFAULT_RESULT,
			error: err,
		};
	}
}
