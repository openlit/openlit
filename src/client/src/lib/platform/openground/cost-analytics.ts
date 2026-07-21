import { dataCollector, MetricParams } from "@/lib/platform/common";
import {
	OPENLIT_OPENGROUND_TABLE_NAME,
	OPENLIT_OPENGROUND_PROVIDERS_TABLE_NAME,
} from "@/lib/platform/openground/table-details";
import { getDBConfigByUser } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import Sanitizer from "@/utils/sanitizer";
import { getFilterPreviousParams } from "@/helpers/server/platform";

function timeWhere(params: MetricParams, alias = "o") {
	return `
		${alias}.created_at >= parseDateTimeBestEffort('${params.timeLimit.start}')
		AND ${alias}.created_at <= parseDateTimeBestEffort('${params.timeLimit.end}')
	`;
}

async function getActiveDatabaseConfigId(): Promise<string | null> {
	const [err, dbConfig] = await asaw(getDBConfigByUser(true));
	if (err || !dbConfig?.id) return null;
	return dbConfig.id as string;
}

export async function getOpengroundTotalCost(params: MetricParams) {
	const databaseConfigId = await getActiveDatabaseConfigId();
	if (!databaseConfigId) {
		return { data: [{ total_cost: 0, previous_total_cost: 0 }] };
	}

	const sanitizedId = Sanitizer.sanitizeValue(databaseConfigId);
	const current = params;
	const previous = getFilterPreviousParams(current);
	// Shared join key (same pattern as LLM getTotalCost) so the INNER JOIN
	// still returns a row when current vs previous window starts differ.
	const joinKey = Sanitizer.sanitizeValue(String(params.timeLimit.start));

	const periodQuery = (periodParams: MetricParams) => `
		SELECT
			sum(toFloat64OrZero(p.cost)) AS total_cost,
			'${joinKey}' AS start_date
		FROM ${OPENLIT_OPENGROUND_PROVIDERS_TABLE_NAME} AS p
		INNER JOIN ${OPENLIT_OPENGROUND_TABLE_NAME} AS o
			ON p.openground_id = o.id
		WHERE o.database_config_id = '${sanitizedId}'
			AND ${timeWhere(periodParams, "o")}
	`;

	const query = `
		SELECT
			CAST(current_data.total_cost AS FLOAT) AS total_cost,
			CAST(previous_day.total_cost AS FLOAT) AS previous_total_cost
		FROM (${periodQuery(current)}) AS current_data
		JOIN (${periodQuery(previous)}) AS previous_day
		ON current_data.start_date = previous_day.start_date
	`;

	return dataCollector({ query }, "query", databaseConfigId);
}

export async function getOpengroundCostByProvider(params: MetricParams) {
	const databaseConfigId = await getActiveDatabaseConfigId();
	if (!databaseConfigId) {
		return { data: [] };
	}

	const sanitizedId = Sanitizer.sanitizeValue(databaseConfigId);
	const query = `
		SELECT
			p.provider AS provider,
			SUM(toFloat64OrZero(p.cost)) AS cost
		FROM ${OPENLIT_OPENGROUND_PROVIDERS_TABLE_NAME} AS p
		INNER JOIN ${OPENLIT_OPENGROUND_TABLE_NAME} AS o
			ON p.openground_id = o.id
		WHERE o.database_config_id = '${sanitizedId}'
			AND ${timeWhere(params, "o")}
			AND notEmpty(p.provider)
		GROUP BY provider
		ORDER BY cost DESC
	`;

	return dataCollector({ query }, "query", databaseConfigId);
}

export async function getOpengroundCostAnalytics(params: MetricParams) {
	const [totalRes, byProviderRes] = await Promise.all([
		getOpengroundTotalCost(params),
		getOpengroundCostByProvider(params),
	]);

	const totalRow = Array.isArray(totalRes.data)
		? (totalRes.data[0] as {
				total_cost?: number;
				previous_total_cost?: number;
			})
		: undefined;

	return {
		data: [
			{
				total_cost: Number(totalRow?.total_cost) || 0,
				previous_total_cost: Number(totalRow?.previous_total_cost) || 0,
			},
		],
		byProvider: byProviderRes.data || [],
		err: totalRes.err || byProviderRes.err,
	};
}
