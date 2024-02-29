import { DatabaseConfig } from "@prisma/client";
import { getDBConfigByUser } from "../db-config";
import createClickhousePool from "./clickhouse-client";
import { DB_META_KEYS } from "@/constants/dbConfig";
import asaw from "@/utils/asaw";

export const DATA_TABLE_NAME = "DOKU_LLM_DATA";
export const API_KEY_TABLE_NAME = "doku_apikeys";

export type TimeLimit = {
	start: Date;
	end: Date;
};

export interface DokuParams {
	timeLimit: TimeLimit;
}

export type DokuRequestParams = DokuParams & {
	config?: {
		endpoints?: boolean;
		maxUsageCost?: boolean;
		models?: boolean;
		totalRows?: boolean;
	};
	offset?: number;
	limit?: number;
};

export type DataCollectorType = { err?: unknown; data?: unknown };
export async function dataCollector(query: string): Promise<DataCollectorType> {
	const [err, dbConfig] = await asaw(getDBConfigByUser(true));
	if (err) return { err, data: [] };
	const clickhousePool = createClickhousePool(
		((dbConfig as DatabaseConfig)?.meta as Record<string, any>)?.[
			DB_META_KEYS.url
		] || ""
	);
	const client = await clickhousePool.acquire();

	try {
		const result = await client.query({ query, format: "JSONEachRow" });
		const data = await result.json();
		return { data };
	} catch (error: any) {
		console.trace(error);
		return { err: `ClickHouse Query Error: ${error.message}`, data: [] };
	} finally {
		clickhousePool.release(client);
	}
}
