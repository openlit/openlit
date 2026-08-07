import { Pool } from "generic-pool";
import { getDBConfigById, getDBConfigByUser } from "../db-config";
import createClickhousePool from "./clickhouse/clickhouse-client";
import asaw from "@/utils/asaw";
import {
	ClickHouseClient,
	QueryParams,
	InsertParams,
	ExecParams,
	CommandParams,
} from "@clickhouse/client";
import { OPERATION_TYPE } from "@/types/platform";

export const OTEL_TRACES_TABLE_NAME = "otel_traces";
export const OTEL_LOGS_TABLE_NAME = "otel_logs";
export const OTEL_GPUS_TABLE_NAME = "otel_metrics_gauge";
export const OTEL_METRICS_GAUGE_TABLE_NAME = "otel_metrics_gauge";
export const OTEL_METRICS_SUM_TABLE_NAME = "otel_metrics_sum";
export const OTEL_METRICS_HISTOGRAM_TABLE_NAME = "otel_metrics_histogram";
export const OTEL_METRICS_SUMMARY_TABLE_NAME = "otel_metrics_summary";
export const OTEL_METRICS_EXPONENTIAL_HISTOGRAM_TABLE_NAME =
	"otel_metrics_exponential_histogram";

export type TimeLimit = {
	start: Date | string;
	end: Date | string;
	type: string;
};

export interface MetricParams {
	timeLimit: TimeLimit;
	offset?: number;
	limit?: number;
	selectedConfig?: any;
	sorting?: any;
	operationType?: OPERATION_TYPE;
	statusCode?: string[];
	/**
	 * Explicit telemetry source id (e.g. a dashboard widget's bound `sourceId`).
	 * When set, read facades resolve metadata against this source instead of the
	 * project's default routing, so the query builder sees the fields that the
	 * widget's actual source can serve.
	 */
	sourceId?: string;
	/** Explicit project ClickHouse configuration selected by the request. */
	databaseConfigId?: string;
	environment?: string;
}

export type GPU_TYPE_KEY =
	| "utilization"
	| "enc.utilization"
	| "dec.utilization"
	| "temperature"
	| "fan_speed"
	| "memory.available"
	| "memory.total"
	| "memory.used"
	| "memory.free"
	| "power.draw"
	| "power.limit";

export interface GPUMetricParams extends MetricParams { }

export type DataCollectorType = { err?: unknown; data?: unknown };
type CollectorParams = Partial<
	QueryParams &
		InsertParams &
		ExecParams &
		CommandParams & { enable_readonly?: boolean }
>;
type CollectorQueryType = "query" | "command" | "insert" | "exec" | "ping";

async function collectClickHouseData(
	{
		query,
		format = "JSONEachRow",
		table,
		values,
		clickhouse_settings,
		enable_readonly,
	}: CollectorParams,
	clientQueryType: CollectorQueryType,
	dbConfigId: string | undefined,
	readPath: "openplait" | "direct"
): Promise<DataCollectorType> {
	let err, dbConfig;
	if (dbConfigId) {
		[err, dbConfig] = await asaw(getDBConfigById({ id: dbConfigId }));
	} else {
		[err, dbConfig] = await asaw(getDBConfigByUser(true));
	}

	if (err) return { err, data: [] };
	let clickhousePool: Pool<ClickHouseClient> | undefined;
	let client: ClickHouseClient | undefined;

	try {
		if (clientQueryType === "query" && readPath === "openplait") {
			if (!query) return { err: "No query specified!" };
			const { executeOpenPlaitRead } = await import("./openplait");
			const [queryErr, rows] = await asaw(
				executeOpenPlaitRead({ query, dbConfig })
			);
			return { err: queryErr, data: rows || [] };
		}

		clickhousePool = createClickhousePool(dbConfig);
		const [err, clientClick] = await asaw(clickhousePool.acquire());

		if (err) {
			return { err, data: [] };
		}
		client = clientClick;
		if (!client)
			return { err: "Clickhouse client is not available!", data: [] };
		let respErr;
		let result;

		if (clientQueryType === "query") {
			if (!query) return { err: "No query specified!" };
			const querySettings = {
				...(enable_readonly ? { readonly: "1" } : {}),
				...(clickhouse_settings || {}),
			};
			[respErr, result] = await asaw(
				client.query({
					query,
					format,
					...(Object.keys(querySettings).length
						? { clickhouse_settings: querySettings }
						: {}),
				} as QueryParams)
			);
			if (!respErr && result) {
				const [jsonErr, rows] = await asaw((result as any).json());
				return { err: jsonErr, data: rows || [] };
			}
		} else if (clientQueryType === "insert") {
			if (!table || !values) return { err: "No table specified!" };
			const insertParams: Record<string, unknown> = {
				table,
				values,
				format,
			};
			if (clickhouse_settings) {
				insertParams.clickhouse_settings = clickhouse_settings;
			}
			[respErr, result] = await asaw(
				client.insert(insertParams as any)
			);

			if (!respErr) {
				return { data: result };
			}
		} else if (clientQueryType === "exec") {
			if (!query) return { err: "No query specified!" };
			[respErr, result] = await asaw(
				client.exec({
					query,
				})
			);

			if (!respErr) {
				return { data: result };
			}
		} else if (clientQueryType === "ping") {
			[respErr, result] = await asaw(client.query({
				query: "SELECT 1",
			}));

			return { err: respErr, data: !!result };
		} else if (clientQueryType === "command") {
			if (!query) return { err: "No query specified!" };
			[respErr, result] = await asaw(
				client.command({
					query,
				})
			);

			if (result?.query_id) {
				return { data: "Query executed successfully!" };
			}
		}

		return { err: respErr || "Unable to process the information" };
	} catch (error: any) {
		return { err: `ClickHouse Query Error: ${error.message}`, data: [] };
	} finally {
		if (clickhousePool && client) clickhousePool?.release(client);
	}
}

/**
 * Shared read boundary for product telemetry. Every traces/logs/metrics read,
 * including the built-in ClickHouse source, must enter ClickHouse through
 * OpenPlait here. Mutations retain the native ClickHouse client.
 */
export async function dataCollector(
	params: CollectorParams,
	clientQueryType: CollectorQueryType = "query",
	dbConfigId?: string
): Promise<DataCollectorType> {
	return collectClickHouseData(
		params,
		clientQueryType,
		dbConfigId,
		"openplait"
	);
}

/**
 * Deliberate exception for OpenLIT's internal intelligence/materialization
 * layer. These queries read and write OpenLIT-owned ClickHouse state directly;
 * they are not datasource signal reads and must not pass through OpenPlait.
 */
export async function intelligenceDataCollector(
	params: CollectorParams,
	clientQueryType: CollectorQueryType = "query",
	dbConfigId?: string
): Promise<DataCollectorType> {
	return collectClickHouseData(params, clientQueryType, dbConfigId, "direct");
}
