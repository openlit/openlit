/**
 * Pure mapper between OpenLIT evaluation types and TypeSafe System One.
 *
 * Transport is separate (`run-jev-evaluation.ts` posts to `/v1/systemone`).
 * A future AI SDK `evaluate({ model: 'typesafe-ai/jev' })` adapter can reuse
 * these functions and only swap boolean ↔ noul plus confidence from
 * `providerMetadata.typesafe`.
 */

import { Evaluation } from "@/types/evaluation";
import { EVALUATION_TYPES } from "@/constants/evaluation-types";

export const TYPESAFE_PROVIDER_ID = "typesafe";
export const TYPESAFE_DEFAULT_MODEL = "jev-latest";
export const JEV_QUALITY_SCORE_LEVELS = [
	"none",
	"minor",
	"moderate",
	"severe",
] as const;

const ISSUE_TYPE_IDS = new Set([
	"hallucination",
	"bias",
	"toxicity",
	"safety",
	"sensitivity",
]);

const QUALITY_TYPE_IDS = new Set([
	"relevance",
	"coherence",
	"faithfulness",
	"instruction_following",
	"completeness",
	"conciseness",
]);

const DEFAULT_TYPE_IDS = ["hallucination", "bias", "toxicity"] as const;

export type JevQuestionKind = "noul" | "score";

export type EvaluationTypeForJev = {
	id: string;
	label?: string;
	prompt?: string;
	defaultPrompt?: string;
	thresholdScore?: number;
	isCustom?: boolean;
};

export type JevNoulQuestion = {
	type: "noul";
	instructions: string;
};

export type JevScoreQuestion = {
	type: "score";
	instructions: string;
	criteria: string[];
};

export type JevQuestion = JevNoulQuestion | JevScoreQuestion;

export type SystemOneRequestBody = {
	state: {
		prompt: string;
		response: string;
		ground_truth_context: string;
	};
	model: string;
	questions: Record<string, JevQuestion>;
};

export type SystemOneAnswer =
	| { type: "noul"; noul: number }
	| {
			type: "choice";
			choice: string;
			probabilities?: Record<string, number>;
			confidence?: number;
	  }
	| {
			type: "score";
			score: number;
			legend?: string | Record<string, string>;
			probabilities?: Record<string, number>;
			confidence?: number;
	  };

export type SystemOneResponseBody = {
	model?: string;
	answers?: Record<string, SystemOneAnswer>;
	usage?: { input_tokens?: number | null; output_tokens?: number | null };
};

export type JevMappedResult = {
	evaluations: Evaluation[];
	extraMeta: Record<string, string>;
};

export function stripEvaluationContextHeader(prompt: string): string {
	return String(prompt || "")
		.replace(/^\[[^\]]+ evaluation context\]\s*/i, "")
		.trim();
}

export function resolveEvaluationTypeLabel(
	type: Pick<EvaluationTypeForJev, "id" | "label">
): string {
	if (type.label?.trim()) return type.label.trim();
	return EVALUATION_TYPES.find((t) => t.id === type.id)?.label ?? type.id;
}

export function questionKindForType(
	type: Pick<EvaluationTypeForJev, "id" | "isCustom">
): JevQuestionKind {
	if (type.isCustom) return "noul";
	if (QUALITY_TYPE_IDS.has(type.id)) return "score";
	if (ISSUE_TYPE_IDS.has(type.id)) return "noul";
	return "noul";
}

function instructionsForType(type: EvaluationTypeForJev): string {
	const raw = type.prompt?.trim() || type.defaultPrompt?.trim() || "";
	const stripped = stripEvaluationContextHeader(raw);
	if (stripped) return stripped;
	const label = resolveEvaluationTypeLabel(type);
	return `Evaluate ${label} of the model response against the prompt and ground-truth context.`;
}

function scoreCriteria(): string[] {
	return [...JEV_QUALITY_SCORE_LEVELS];
}

export function resolveJevTypes(
	evaluationTypes?: EvaluationTypeForJev[]
): EvaluationTypeForJev[] {
	const enabled = (evaluationTypes || []).filter((t) => t?.id);
	if (enabled.length > 0) return enabled;
	return DEFAULT_TYPE_IDS.map((id) => {
		const builtIn = EVALUATION_TYPES.find((t) => t.id === id);
		return {
			id,
			label: builtIn?.label ?? id,
		};
	});
}

export function buildSystemOneRequest(params: {
	prompt?: string;
	response?: string;
	groundTruthContext?: string;
	model: string;
	evaluationTypes?: EvaluationTypeForJev[];
}): SystemOneRequestBody {
	const types = resolveJevTypes(params.evaluationTypes);
	const questions: Record<string, JevQuestion> = {};
	for (const type of types) {
		const instructions = instructionsForType(type);
		if (questionKindForType(type) === "score") {
			questions[type.id] = {
				type: "score",
				instructions,
				criteria: scoreCriteria(),
			};
		} else {
			questions[type.id] = {
				type: "noul",
				instructions,
			};
		}
	}

	return {
		state: {
			prompt: params.prompt ?? "",
			response: params.response ?? "",
			ground_truth_context: params.groundTruthContext ?? "",
		},
		model: params.model,
		questions,
	};
}

function asFiniteNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function legendLabel(
	answer: Extract<SystemOneAnswer, { type: "score" }>,
	scoreValue: number
): string {
	if (typeof answer.legend === "string" && answer.legend.trim()) {
		return answer.legend.trim();
	}
	if (answer.legend && typeof answer.legend === "object") {
		const keyed =
			answer.legend[String(scoreValue)] ?? answer.legend[scoreValue as unknown as string];
		if (typeof keyed === "string" && keyed.trim()) return keyed.trim();
	}
	return JEV_QUALITY_SCORE_LEVELS[scoreValue] ?? "none";
}

function synthesizeExplanation(params: {
	label: string;
	score: number;
	classification: string;
}): string {
	if (params.classification === "none") {
		return `No ${params.label} detected`;
	}
	if (params.classification === "detected") {
		return `${params.label} detected (score ${params.score.toFixed(2)})`;
	}
	return `${params.label} classified as ${params.classification} (score ${params.score.toFixed(2)})`;
}

function normalizeScoreSeverity(rawScore: number, levelCount: number): number {
	const max = Math.max(levelCount - 1, 1);
	const clamped = Math.min(Math.max(rawScore, 0), max);
	return clamped / max;
}

function noulClassification(noul: number): string {
	if (noul <= 0) return "none";
	if (noul < 0.25) return "low";
	if (noul < 0.5) return "moderate";
	return "detected";
}

export function mapSystemOneAnswers(params: {
	types?: EvaluationTypeForJev[];
	answers?: Record<string, SystemOneAnswer>;
	thresholdScore?: number;
	resolvedModel?: string;
}): JevMappedResult {
	const types = resolveJevTypes(params.types);
	const answers = params.answers || {};
	const defaultThreshold = params.thresholdScore ?? 0.5;
	const evaluations: Evaluation[] = [];
	const confidenceByType: Record<string, number> = {};
	const probabilitiesByType: Record<string, Record<string, number>> = {};

	for (const type of types) {
		const label = resolveEvaluationTypeLabel(type);
		const threshold = type.thresholdScore ?? defaultThreshold;
		const answer = answers[type.id];
		let score = 0;
		let classification = "none";
		let confidence: number | undefined;

		if (answer?.type === "noul") {
			score = Math.min(Math.max(asFiniteNumber(answer.noul) ?? 0, 0), 1);
			classification = noulClassification(score);
		} else if (answer?.type === "score") {
			const raw = asFiniteNumber(answer.score) ?? 0;
			score = normalizeScoreSeverity(raw, JEV_QUALITY_SCORE_LEVELS.length);
			classification = legendLabel(answer, Math.round(raw));
			confidence = asFiniteNumber(answer.confidence);
			if (answer.probabilities && typeof answer.probabilities === "object") {
				probabilitiesByType[label] = answer.probabilities;
			}
		} else if (answer?.type === "choice") {
			score = 0;
			classification = answer.choice || "none";
			confidence = asFiniteNumber(answer.confidence);
			if (answer.probabilities && typeof answer.probabilities === "object") {
				probabilitiesByType[label] = answer.probabilities;
			}
		}

		if (confidence != null) {
			confidenceByType[label] = confidence;
		}

		const verdict: Evaluation["verdict"] = score > threshold ? "yes" : "no";
		evaluations.push({
			score,
			evaluation: label,
			classification,
			explanation: synthesizeExplanation({
				label,
				score,
				classification,
			}),
			verdict,
		});
	}

	const extraMeta: Record<string, string> = {
		engine: TYPESAFE_PROVIDER_ID,
	};
	if (params.resolvedModel) {
		extraMeta.resolvedModel = params.resolvedModel;
	}
	if (Object.keys(confidenceByType).length > 0) {
		extraMeta.confidence = JSON.stringify(confidenceByType);
	}
	if (Object.keys(probabilitiesByType).length > 0) {
		extraMeta.probabilities = JSON.stringify(probabilitiesByType);
	}

	return { evaluations, extraMeta };
}
