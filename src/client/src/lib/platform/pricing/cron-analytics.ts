import { dataCollector, MetricParams } from "@/lib/platform/common";
import { OPENLIT_CRON_LOG_TABLE_NAME } from "@/lib/platform/cron-log/table-details";
import { CronType } from "@/types/cron";
import Sanitizer from "@/utils/sanitizer";
import { getFilterPreviousParams } from "@/helpers/server/platform";

export type PricingCronRunRow = {
	startedAt: string;
	finishedAt: string;
	duration: number;
	runStatus: string;
	totalSpans: number;
	totalUpdated: number;
	totalFailed: number;
	totalSkipped: number;
};

export type PricingCronAnalyticsSummary = {
	totalRuns: number;
	previousTotalRuns: number;
	totalUpdated: number;
	previousTotalUpdated: number;
	totalSpans: number;
	previousTotalSpans: number;
	successfulRuns: number;
	previousSuccessfulRuns: number;
};

function timeWhere(params: MetricParams) {
	const start = Sanitizer.sanitizeValue(String(params.timeLimit.start));
	const end = Sanitizer.sanitizeValue(String(params.timeLimit.end));
	return `
		started_at >= parseDateTimeBestEffort('${start}')
		AND started_at <= parseDateTimeBestEffort('${end}')
		AND cron_type = '${CronType.SPAN_PRICING}'
	`;
}

function toNumber(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

async function getSummaryForPeriod(
	params: MetricParams
): Promise<PricingCronAnalyticsSummary & { err?: unknown }> {
	const query = `
		SELECT
			count() AS totalRuns,
			countIf(run_status = 'SUCCESS' OR run_status = 'PARTIAL_SUCCESS') AS successfulRuns,
			sum(toFloat64OrZero(meta['totalUpdated'])) AS totalUpdated,
			sum(toFloat64OrZero(meta['totalSpans'])) AS totalSpans
		FROM ${OPENLIT_CRON_LOG_TABLE_NAME}
		WHERE ${timeWhere(params)}
	`;

	const { data, err } = await dataCollector({ query });
	if (err) {
		return {
			err,
			totalRuns: 0,
			previousTotalRuns: 0,
			totalUpdated: 0,
			previousTotalUpdated: 0,
			totalSpans: 0,
			previousTotalSpans: 0,
			successfulRuns: 0,
			previousSuccessfulRuns: 0,
		};
	}

	const row = Array.isArray(data) ? data[0] : undefined;
	return {
		totalRuns: toNumber(row?.totalRuns),
		previousTotalRuns: 0,
		totalUpdated: toNumber(row?.totalUpdated),
		previousTotalUpdated: 0,
		totalSpans: toNumber(row?.totalSpans),
		previousTotalSpans: 0,
		successfulRuns: toNumber(row?.successfulRuns),
		previousSuccessfulRuns: 0,
	};
}

export async function getPricingCronAnalytics(
	params: MetricParams,
	options?: { limit?: number }
) {
	const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
	const previousParams = getFilterPreviousParams(params);

	const [current, previous, runsRes] = await Promise.all([
		getSummaryForPeriod(params),
		getSummaryForPeriod(previousParams),
		dataCollector({
			query: `
				SELECT
					started_at AS startedAt,
					finished_at AS finishedAt,
					duration,
					run_status AS runStatus,
					toFloat64OrZero(meta['totalSpans']) AS totalSpans,
					toFloat64OrZero(meta['totalUpdated']) AS totalUpdated,
					toFloat64OrZero(meta['totalFailed']) AS totalFailed,
					toFloat64OrZero(meta['totalSkipped']) AS totalSkipped
				FROM ${OPENLIT_CRON_LOG_TABLE_NAME}
				WHERE ${timeWhere(params)}
					AND toFloat64OrZero(meta['totalUpdated']) > 0
				ORDER BY started_at DESC
				LIMIT ${limit}
			`,
		}),
	]);

	const runs = ((runsRes.data as PricingCronRunRow[]) || []).map((row) => ({
		startedAt: String(row.startedAt ?? ""),
		finishedAt: String(row.finishedAt ?? ""),
		duration: toNumber(row.duration),
		runStatus: String(row.runStatus ?? ""),
		totalSpans: toNumber(row.totalSpans),
		totalUpdated: toNumber(row.totalUpdated),
		totalFailed: toNumber(row.totalFailed),
		totalSkipped: toNumber(row.totalSkipped),
	}));

	return {
		data: [
			{
				total_runs: current.totalRuns,
				previous_total_runs: previous.totalRuns,
				successful_runs: current.successfulRuns,
				previous_successful_runs: previous.successfulRuns,
				total_updated: current.totalUpdated,
				previous_total_updated: previous.totalUpdated,
				total_spans: current.totalSpans,
				previous_total_spans: previous.totalSpans,
			},
		],
		runs,
		err: current.err || previous.err || runsRes.err,
	};
}
