import { Pool } from "generic-pool";
import { getDBConfigByUser } from "../db-config";
import createClickhousePool from "./clickhouse-client";
import asaw from "@/utils/asaw";
import {
	ClickHouseClient,
	QueryParams,
	InsertParams,
	CommandParams,
} from "@clickhouse/client-common";

export const OTEL_TRACES_TABLE_NAME = "otel_traces";
export const OTEL_GPUS_TABLE_NAME = "otel_metrics_gauge";

export type OPERATION_TYPE = "llm" | "vectordb";

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
}

export type GPU_TYPE_KEY =
	| "utilization_percentage"
	| "enc.utilization_percentage"
	| "dec.utilization_percentage"
	| "temperature"
	| "fan_speed"
	| "memory.available"
	| "memory.total"
	| "memory.used"
	| "memory.free"
	| "power.draw"
	| "power.limit";

export interface GPUMetricParams extends MetricParams {}

export type DataCollectorType = { err?: unknown; data?: unknown };
export async function dataCollector(
	{
		query,
		format = "JSONEachRow",
		table,
		values,
	}: Partial<QueryParams & InsertParams & CommandParams>,
	clientQueryType: "query" | "command" | "insert" | "ping" = "query"
): Promise<DataCollectorType> {
	const [err, dbConfig] = await asaw(getDBConfigByUser(true));
	if (err) return { err, data: [] };
	let clickhousePool: Pool<ClickHouseClient> | undefined;
	let client: ClickHouseClient | undefined;

	try {
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
			[respErr, result] = await asaw(
				client.query({
					query,
					format,
				})
			);

			if (result) {
				const [err, data] = await asaw(result?.json());
				return { err, data };
			}
		} else if (clientQueryType === "insert") {
			if (!table || !values) return { err: "No table specified!" };
			[respErr, result] = await asaw(
				client.insert({
					table,
					values,
					format,
				})
			);

			if (result?.query_id) {
				return { data: "Added successfully!" };
			}
		} else if (clientQueryType === "ping") {
			[respErr, result] = await asaw(client.ping());

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
