/**
 * Logs read facade — choke point for Telemetry logs list/detail/summary.
 *
 * Every source resolves through the shared signal facade and executes the
 * DataSourceAdapter contract (including built-in ClickHouse).
 */

import type { MetricParams } from "@/lib/platform/common";
import { metricParamsToOpenLITQuery } from "@/lib/platform/connectors/datasource/clickhouse/query-map";
import { denormalizeLogToClickHouseRow } from "@/lib/platform/connectors/datasource/clickhouse/normalize";
import {
	facadeErrorMessage,
	resolveSignalReadContext,
	rethrowIfSourceFailure,
} from "@/lib/platform/connectors/datasource/facade";

export async function getLogs(params: MetricParams) {
	const { adapter } = await resolveSignalReadContext("logs", params);
	try {
		const frame = await adapter.listLogs(
			metricParamsToOpenLITQuery(params, "logs")
		);
		const rows = (frame.rows || []).map(denormalizeLogToClickHouseRow);
		const offset = params.offset || 0;
		const limit = params.limit || 25;
		return {
			err: null,
			records: rows.slice(offset, offset + limit),
			total: Number(frame.meta?.rowsScanned) || rows.length,
			freshness: frame.meta?.freshness || "live",
		};
	} catch (error) {
		rethrowIfSourceFailure(error);
		return { err: facadeErrorMessage(error), records: [], total: 0 };
	}
}

export async function getLogByRowId(
	rowId: string,
	params: Pick<
		MetricParams,
		"databaseConfigId" | "sourceId" | "environment"
	> & {
		aroundTimestamp?: string | Date;
	} = {}
) {
	const contextParams = {
		timeLimit: { start: new Date(0), end: new Date(), type: "all" },
		...params,
	} as MetricParams;
	const { adapter } = await resolveSignalReadContext("logs", contextParams);
	try {
		const log = await adapter.getLog(rowId, {
			aroundTimestamp: params.aroundTimestamp,
		});
		return {
			err: null,
			record: log ? denormalizeLogToClickHouseRow(log) : undefined,
		};
	} catch (error) {
		return { err: facadeErrorMessage(error), record: undefined };
	}
}

export async function getLogsConfig(params: MetricParams) {
	const { adapter } = await resolveSignalReadContext("logs", params);
	try {
		const query = metricParamsToOpenLITQuery(params, "logs");
		const services = await adapter
			.distinctValues("service.name", query)
			.catch(() => [] as string[]);
		return {
			err: null,
			data: [{ services, severities: [], totalRows: 0 }],
		};
	} catch (error) {
		return { err: facadeErrorMessage(error), data: [] };
	}
}

export async function getLogAttributeKeys(params: MetricParams) {
	const { adapter } = await resolveSignalReadContext("logs", params);
	try {
		const keys = await adapter.attributeKeys(
			"logs",
			metricParamsToOpenLITQuery(params, "logs").timeRange
		);
		return {
			err: null,
			spanAttributeKeys: [],
			resourceAttributeKeys: keys,
			logAttributeKeys: keys,
			scopeAttributeKeys: [],
		};
	} catch (error) {
		return {
			err: facadeErrorMessage(error),
			spanAttributeKeys: [],
			resourceAttributeKeys: [],
			logAttributeKeys: [],
			scopeAttributeKeys: [],
		};
	}
}

export async function getLogsSummary(params: MetricParams) {
	const { adapter } = await resolveSignalReadContext("logs", params);
	try {
		const frame = await adapter.logTimeSeries(
			metricParamsToOpenLITQuery(params, "logs")
		);
		const buckets = (frame.rows || []).map((row) => {
			const record = row as Record<string, unknown>;
			const count = Number(record.count ?? record.value ?? 0);
			return {
				...record,
				label: String(record.label || record.timestamp || ""),
				count: Number.isFinite(count) ? count : 0,
			};
		});
		return {
			err: null,
			bucket: "auto",
			buckets,
			total: buckets.reduce((sum, row) => sum + row.count, 0),
			peak: buckets.reduce((max, row) => Math.max(max, row.count), 0),
		};
	} catch (error) {
		rethrowIfSourceFailure(error);
		return {
			err: facadeErrorMessage(error),
			bucket: "auto",
			buckets: [],
			total: 0,
			peak: 0,
		};
	}
}
