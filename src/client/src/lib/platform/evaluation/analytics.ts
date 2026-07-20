import { dataCollector, MetricParams } from "../common";
import { OPENLIT_EVALUATION_TABLE_NAME } from "./table-details";
import {
	dateTruncGroupingLogic,
	getFilterPreviousParams,
} from "@/helpers/server/platform";
import { EVALUATION_SOURCE } from "@/constants/evaluation-sources";
import asaw from "@/utils/asaw";
import { getEvaluationConfig } from "./config";
import { EVALUATION_TYPES } from "@/constants/evaluation-types";
import { getEvaluationStoredNameVariants } from "@/helpers/client/evaluation-type";
import type {
	EvaluationAnalyticsByTypeRow,
	EvaluationAnalyticsResponse,
	EvaluationAnalyticsSummary,
	EvaluationAnalyticsTimeseriesPoint,
} from "@/types/evaluation";

export type {
	EvaluationAnalyticsByTypeRow,
	EvaluationAnalyticsResponse,
	EvaluationAnalyticsSummary,
	EvaluationAnalyticsTimeseriesPoint,
};

const EXCLUDED_SOURCES = `('${EVALUATION_SOURCE.MANUAL_FEEDBACK}', '${EVALUATION_SOURCE.AUTO_SKIPPED}')`;

function timeWhere(parameters: MetricParams) {
	return `
		created_at >= parseDateTimeBestEffort('${parameters.timeLimit.start}')
		AND created_at <= parseDateTimeBestEffort('${parameters.timeLimit.end}')
		AND meta['source'] NOT IN ${EXCLUDED_SOURCES}
	`;
}

function escapeSqlString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function evaluationNameWhere(variants: string[]): string {
	if (variants.length === 0) return "1 = 0";
	const list = variants
		.map((v) => `'${escapeSqlString(v)}'`)
		.join(", ");
	return `evaluationData.evaluation IN (${list})`;
}

/**
 * Name variants for configured evaluators only. Hub KPIs / charts must not
 * include random ClickHouse labels (TypeA, ad-hoc judge names, etc.).
 */
async function getConfiguredEvaluationNameVariants(): Promise<string[]> {
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	const configured = (!err && Array.isArray(config?.evaluationTypes)
		? config.evaluationTypes
		: []) as Array<{ id: string; label?: string }>;

	const types =
		configured.length > 0
			? configured
			: EVALUATION_TYPES.map((t) => ({ id: t.id, label: t.label }));

	const variants = new Set<string>();
	for (const type of types) {
		if (!type?.id) continue;
		const label =
			type.label ||
			EVALUATION_TYPES.find((t) => t.id === type.id)?.label ||
			type.id;
		for (const name of getEvaluationStoredNameVariants(type.id, label)) {
			variants.add(name);
		}
	}
	return Array.from(variants);
}

async function getTypeCounts(): Promise<{ evaluations: number; active: number }> {
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		return { evaluations: EVALUATION_TYPES.length, active: 0 };
	}

	const types = config.evaluationTypes || [];
	const evaluations = types.length || EVALUATION_TYPES.length;
	const active = types.filter((t: { enabled?: boolean }) => t.enabled).length;
	return { evaluations, active };
}

export async function getEvaluationAnalyticsSummary(
	params: MetricParams
): Promise<{
	err?: unknown;
	data?: EvaluationAnalyticsSummary;
}> {
	const current = params;
	const previous = getFilterPreviousParams(current);
	const variants = await getConfiguredEvaluationNameVariants();
	const nameWhere = evaluationNameWhere(variants);

	const periodQuery = (parameters: MetricParams) => `
		SELECT
			(
				SELECT countDistinct(span_id)
				FROM ${OPENLIT_EVALUATION_TABLE_NAME}
				ARRAY JOIN evaluationData
				WHERE ${timeWhere(parameters)}
					AND ${nameWhere}
			) AS tracesEvaluated,
			(
				SELECT countDistinct(id)
				FROM ${OPENLIT_EVALUATION_TABLE_NAME}
				ARRAY JOIN evaluationData
				WHERE ${timeWhere(parameters)}
					AND ${nameWhere}
			) AS executions,
			(
				SELECT countDistinct(if(meta['source'] = '${EVALUATION_SOURCE.AUTO}', id, NULL))
				FROM ${OPENLIT_EVALUATION_TABLE_NAME}
				ARRAY JOIN evaluationData
				WHERE ${timeWhere(parameters)}
					AND ${nameWhere}
			) AS autoExecutions,
			(
				SELECT sum(runCost)
				FROM (
					SELECT
						id,
						any(toFloat64OrZero(meta['cost'])) AS runCost
					FROM ${OPENLIT_EVALUATION_TABLE_NAME}
					ARRAY JOIN evaluationData
					WHERE ${timeWhere(parameters)}
						AND ${nameWhere}
					GROUP BY id
				)
			) AS totalCost,
			(
				SELECT
					if(
						count() = 0,
						0,
						(countIf(evaluationData.verdict != 'yes') * 100.0) / count()
					)
				FROM ${OPENLIT_EVALUATION_TABLE_NAME}
				ARRAY JOIN evaluationData
				WHERE ${timeWhere(parameters)}
					AND ${nameWhere}
			) AS avgPassRate,
			(
				SELECT countIf(evaluationData.verdict = 'yes')
				FROM ${OPENLIT_EVALUATION_TABLE_NAME}
				ARRAY JOIN evaluationData
				WHERE ${timeWhere(parameters)}
					AND ${nameWhere}
			) AS failedScores
	`;

	const [{ data: currentData, err: currentErr }, { data: previousData, err: previousErr }] =
		await Promise.all([
			dataCollector({ query: periodQuery(current) }),
			dataCollector({ query: periodQuery(previous) }),
		]);

	if (currentErr) return { err: currentErr };
	if (previousErr) return { err: previousErr };

	const row = (currentData as any[])?.[0] || {};
	const prev = (previousData as any[])?.[0] || {};
	const typeCounts = await getTypeCounts();

	return {
		data: {
			tracesEvaluated: Number(row.tracesEvaluated) || 0,
			executions: Number(row.executions) || 0,
			autoExecutions: Number(row.autoExecutions) || 0,
			totalCost: Number(row.totalCost) || 0,
			avgPassRate: Number(row.avgPassRate) || 0,
			failedScores: Number(row.failedScores) || 0,
			previous_tracesEvaluated: Number(prev.tracesEvaluated) || 0,
			previous_executions: Number(prev.executions) || 0,
			previous_autoExecutions: Number(prev.autoExecutions) || 0,
			previous_totalCost: Number(prev.totalCost) || 0,
			previous_avgPassRate: Number(prev.avgPassRate) || 0,
			previous_failedScores: Number(prev.failedScores) || 0,
			evaluations: typeCounts.evaluations,
			active: typeCounts.active,
		},
	};
}

export async function getEvaluationAnalyticsTimeseries(
	params: MetricParams
): Promise<{ err?: unknown; data?: EvaluationAnalyticsTimeseriesPoint[] }> {
	const { start, end } = params.timeLimit;
	const dateTrunc = dateTruncGroupingLogic(end as Date, start as Date);
	const variants = await getConfiguredEvaluationNameVariants();
	const nameWhere = evaluationNameWhere(variants);

	const query = `
		SELECT
			formatDateTime(DATE_TRUNC('${dateTrunc}', created_at), '%Y/%m/%d %H:%i') AS timestamp,
			countDistinct(id) AS executions,
			if(
				count() = 0,
				0,
				(countIf(evaluationData.verdict != 'yes') * 100.0) / count()
			) AS passRate
		FROM ${OPENLIT_EVALUATION_TABLE_NAME}
		ARRAY JOIN evaluationData
		WHERE ${timeWhere(params)}
			AND ${nameWhere}
		GROUP BY timestamp
		ORDER BY timestamp ASC
	`;

	const { data, err } = await dataCollector({ query });
	if (err) return { err };

	return {
		data: ((data as any[]) || []).map((row) => ({
			timestamp: String(row.timestamp || ""),
			executions: Number(row.executions) || 0,
			passRate: Number(row.passRate) || 0,
		})),
	};
}

export async function getEvaluationAnalyticsByType(
	params: MetricParams
): Promise<{ err?: unknown; data?: EvaluationAnalyticsByTypeRow[] }> {
	const current = params;
	const previous = getFilterPreviousParams(current);

	const typeQuery = (parameters: MetricParams) => `
		SELECT
			evaluationData.evaluation AS evaluation,
			countDistinct(id) AS executions,
			if(
				count() = 0,
				0,
				(countIf(evaluationData.verdict != 'yes') * 100.0) / count()
			) AS passRate,
			countIf(evaluationData.verdict = 'yes') AS failedScores
		FROM ${OPENLIT_EVALUATION_TABLE_NAME}
		ARRAY JOIN evaluationData
		WHERE ${timeWhere(parameters)}
		GROUP BY evaluation
	`;

	const [{ data: currentData, err: currentErr }, { data: previousData, err: previousErr }] =
		await Promise.all([
			dataCollector({ query: typeQuery(current) }),
			dataCollector({ query: typeQuery(previous) }),
		]);

	if (currentErr) return { err: currentErr };
	if (previousErr) return { err: previousErr };

	const previousMap = new Map(
		((previousData as any[]) || []).map((row) => [
			String(row.evaluation || ""),
			Number(row.passRate) || 0,
		])
	);

	return {
		data: ((currentData as any[]) || [])
			.map((row) => {
				const evaluation = String(row.evaluation || "");
				return {
					evaluation,
					executions: Number(row.executions) || 0,
					passRate: Number(row.passRate) || 0,
					previousPassRate: previousMap.get(evaluation) || 0,
					failedScores: Number(row.failedScores) || 0,
				};
			})
			.sort((a, b) => b.executions - a.executions),
	};
}

export async function getEvaluationAnalytics(
	params: MetricParams
): Promise<EvaluationAnalyticsResponse> {
	const [configErr, config] = await asaw(
		getEvaluationConfig(undefined, true, false)
	);

	if (configErr || !config?.id) {
		return { configured: false };
	}

	const [summaryRes, timeseriesRes, byTypeRes] = await Promise.all([
		getEvaluationAnalyticsSummary(params),
		getEvaluationAnalyticsTimeseries(params),
		getEvaluationAnalyticsByType(params),
	]);

	return {
		configured: true,
		data: [
			{
				evaluations: summaryRes.data?.evaluations ?? 0,
				previous_evaluations: summaryRes.data?.evaluations ?? 0,
				active: summaryRes.data?.active ?? 0,
				previous_active: summaryRes.data?.active ?? 0,
				traces_evaluated: summaryRes.data?.tracesEvaluated ?? 0,
				previous_traces_evaluated:
					summaryRes.data?.previous_tracesEvaluated ?? 0,
				executions: summaryRes.data?.executions ?? 0,
				previous_executions: summaryRes.data?.previous_executions ?? 0,
				auto_executions: summaryRes.data?.autoExecutions ?? 0,
				previous_auto_executions:
					summaryRes.data?.previous_autoExecutions ?? 0,
				total_cost: summaryRes.data?.totalCost ?? 0,
				previous_total_cost: summaryRes.data?.previous_totalCost ?? 0,
				avg_pass_rate: summaryRes.data?.avgPassRate ?? 0,
				previous_avg_pass_rate: summaryRes.data?.previous_avgPassRate ?? 0,
				failed_scores: summaryRes.data?.failedScores ?? 0,
				previous_failed_scores: summaryRes.data?.previous_failedScores ?? 0,
			},
		],
		summary: summaryRes.data,
		timeseries: timeseriesRes.data || [],
		byType: byTypeRes.data || [],
	};
}

export async function getEvaluationEvaluatorAnalytics(
	params: MetricParams,
	evaluatorId: string
): Promise<import("@/types/evaluation").EvaluationEvaluatorAnalyticsResponse> {
	const [configErr, config] = await asaw(
		getEvaluationConfig(undefined, true, false)
	);

	if (configErr || !config?.id) {
		return { configured: false, found: false };
	}

	const types = (config.evaluationTypes || []) as Array<{
		id: string;
		label?: string;
		enabled?: boolean;
		description?: string;
		isCustom?: boolean;
	}>;
	const typeConfig = types.find((t) => t.id === evaluatorId);
	const builtIn = EVALUATION_TYPES.find((t) => t.id === evaluatorId);

	if (!typeConfig && !builtIn) {
		return { configured: true, found: false };
	}

	const label = typeConfig?.label || builtIn?.label || evaluatorId;
	const variants = getEvaluationStoredNameVariants(evaluatorId, label);
	const nameWhere = evaluationNameWhere(variants);
	const current = params;
	const previous = getFilterPreviousParams(current);
	const { start, end } = params.timeLimit;
	const dateTrunc = dateTruncGroupingLogic(end as Date, start as Date);

	const summaryQuery = (parameters: MetricParams) => `
		SELECT
			countDistinct(id) AS executions,
			sum(toFloat64OrZero(meta['cost'])) AS totalCost,
			if(
				count() = 0,
				0,
				(countIf(evaluationData.verdict != 'yes') * 100.0) / count()
			) AS avgPassRate,
			countIf(evaluationData.verdict = 'yes') AS failedScores,
			countDistinct(span_id) AS tracesEvaluated
		FROM ${OPENLIT_EVALUATION_TABLE_NAME}
		ARRAY JOIN evaluationData
		WHERE ${timeWhere(parameters)}
			AND ${nameWhere}
	`;

	const timeseriesQuery = `
		SELECT
			formatDateTime(DATE_TRUNC('${dateTrunc}', created_at), '%Y/%m/%d %H:%i') AS timestamp,
			countDistinct(id) AS executions,
			if(
				count() = 0,
				0,
				(countIf(evaluationData.verdict != 'yes') * 100.0) / count()
			) AS passRate
		FROM ${OPENLIT_EVALUATION_TABLE_NAME}
		ARRAY JOIN evaluationData
		WHERE ${timeWhere(params)}
			AND ${nameWhere}
		GROUP BY timestamp
		ORDER BY timestamp ASC
	`;

	const recentQuery = `
		SELECT
			id,
			span_id AS spanId,
			created_at AS createdAt,
			evaluationData.verdict AS verdict,
			toFloat64OrZero(toString(scores[evaluationData.evaluation])) AS score,
			evaluationData.classification AS classification,
			evaluationData.explanation AS explanation,
			meta['source'] AS source,
			toFloat64OrZero(meta['cost']) AS cost
		FROM ${OPENLIT_EVALUATION_TABLE_NAME}
		ARRAY JOIN evaluationData
		WHERE ${timeWhere(params)}
			AND ${nameWhere}
		ORDER BY created_at DESC
		LIMIT 25
	`;

	const [
		{ data: currentData, err: currentErr },
		{ data: previousData, err: previousErr },
		{ data: timeseriesData, err: timeseriesErr },
		{ data: recentData, err: recentErr },
	] = await Promise.all([
		dataCollector({ query: summaryQuery(current) }),
		dataCollector({ query: summaryQuery(previous) }),
		dataCollector({ query: timeseriesQuery }),
		dataCollector({ query: recentQuery }),
	]);

	if (currentErr || previousErr || timeseriesErr || recentErr) {
		return {
			configured: true,
			found: true,
			evaluator: {
				id: evaluatorId,
				label,
				enabled: typeConfig?.enabled ?? builtIn?.enabledByDefault ?? false,
				description: typeConfig?.description || builtIn?.description,
				isCustom: typeConfig?.isCustom,
			},
			data: [],
			timeseries: [],
			recentResults: [],
		};
	}

	const row = (currentData as any[])?.[0] || {};
	const prev = (previousData as any[])?.[0] || {};

	return {
		configured: true,
		found: true,
		evaluator: {
			id: evaluatorId,
			label,
			enabled: typeConfig?.enabled ?? builtIn?.enabledByDefault ?? false,
			description: typeConfig?.description || builtIn?.description,
			isCustom: typeConfig?.isCustom,
		},
		data: [
			{
				executions: Number(row.executions) || 0,
				previous_executions: Number(prev.executions) || 0,
				avg_pass_rate: Number(row.avgPassRate) || 0,
				previous_avg_pass_rate: Number(prev.avgPassRate) || 0,
				failed_scores: Number(row.failedScores) || 0,
				previous_failed_scores: Number(prev.failedScores) || 0,
				total_cost: Number(row.totalCost) || 0,
				previous_total_cost: Number(prev.totalCost) || 0,
				traces_evaluated: Number(row.tracesEvaluated) || 0,
				previous_traces_evaluated: Number(prev.tracesEvaluated) || 0,
			},
		],
		timeseries: ((timeseriesData as any[]) || []).map((point) => ({
			timestamp: String(point.timestamp || ""),
			executions: Number(point.executions) || 0,
			passRate: Number(point.passRate) || 0,
		})),
		recentResults: ((recentData as any[]) || []).map((r) => ({
			id: String(r.id || ""),
			spanId: String(r.spanId || ""),
			createdAt: String(r.createdAt || ""),
			verdict: String(r.verdict || ""),
			score: Number(r.score) || 0,
			classification: String(r.classification || ""),
			explanation: String(r.explanation || ""),
			source: r.source ? String(r.source) : undefined,
			cost: Number(r.cost) || 0,
		})),
	};
}
