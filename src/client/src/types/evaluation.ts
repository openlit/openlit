import { EvaluationConfigs } from "@prisma/client";
import { Secret } from "./vault";

export interface EvaluationConfig extends EvaluationConfigs {}

export interface EvaluationConfigInput
	extends Omit<EvaluationConfig, "id" | "databaseConfigId"> {
	id?: string;
	databaseConfigId?: string;
}

export interface ManualFeedback {
	createdAt: Date;
	rating: "positive" | "negative" | "neutral";
	comment?: string;
}

export interface EvaluationRun {
	id: string;
	createdAt: Date;
	meta: Record<string, any>;
	evaluations: Evaluation[];
	cost?: number;
}

export interface EvaluationConfigResponse {
	config?: string;
	configErr?: string;
	data?: EvaluationResponse;
	runs?: EvaluationRun[];
	feedbacks?: ManualFeedback[];
	ruleContext?: {
		matchingRuleIds: string[];
		contextApplied: boolean;
		contextEntityIds?: string[];
	};
	err?: string;
	success?: boolean;
}
export interface Evaluation {
	score: number;
	evaluation: string;
	classification: string;
	explanation: string;
	verdict: string;
}

export interface EvaluationResponse {
	id: string;
	spanId: string;
	createdAt: Date;
	meta: Record<string, any>;
	evaluations: Evaluation[];
}

export interface AutoEvaluationConfig {
	evaluationConfigId: string;
	cronId: string;
}

export type EvaluationConfigWithSecret = EvaluationConfig & { secret: Secret };

export type EvaluationAnalyticsSummary = {
	tracesEvaluated: number;
	executions: number;
	autoExecutions: number;
	totalCost: number;
	avgPassRate: number;
	failedScores: number;
	previous_tracesEvaluated: number;
	previous_executions: number;
	previous_autoExecutions: number;
	previous_totalCost: number;
	previous_avgPassRate: number;
	previous_failedScores: number;
	evaluations: number;
	active: number;
};

export type EvaluationAnalyticsTimeseriesPoint = {
	timestamp: string;
	executions: number;
	passRate: number;
};

export type EvaluationAnalyticsByTypeRow = {
	evaluation: string;
	executions: number;
	passRate: number;
	previousPassRate: number;
	failedScores: number;
};

export type EvaluationAnalyticsRecentResult = {
	id: string;
	spanId: string;
	createdAt: string;
	verdict: string;
	score: number;
	classification: string;
	explanation: string;
	source?: string;
	cost?: number;
};

export type EvaluationEvaluatorAnalyticsResponse = {
	configured: boolean;
	found: boolean;
	evaluator?: {
		id: string;
		label: string;
		enabled: boolean;
		description?: string;
		isCustom?: boolean;
	};
	data?: Array<Record<string, number>>;
	timeseries?: EvaluationAnalyticsTimeseriesPoint[];
	recentResults?: EvaluationAnalyticsRecentResult[];
};

export type EvaluationAnalyticsResponse = {
	configured: boolean;
	data?: Array<Record<string, number>>;
	summary?: EvaluationAnalyticsSummary;
	timeseries?: EvaluationAnalyticsTimeseriesPoint[];
	byType?: EvaluationAnalyticsByTypeRow[];
};

