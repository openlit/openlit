import { parseQueryStringToObject } from "@/utils/parser";
import { ClickHouseClient, createClient } from "@clickhouse/client";
import { DatabaseConfig } from "@prisma/client";
import { createPool, Pool } from "generic-pool";

interface ClickHouseConnectionInfo {
	username: string;
	password: string;
	host: string;
	port: string;
	database: string;
	additional_headers: Record<string, string>;
}

export default function createClickhousePool(
	dbConfig: DatabaseConfig
): Pool<ClickHouseClient> {
	const connectionObject: ClickHouseConnectionInfo = {
		username: dbConfig.username,
		password: dbConfig.password || "",
		host: dbConfig.host,
		port: dbConfig.port,
		database: dbConfig.database,
		additional_headers: parseQueryStringToObject(dbConfig.query || ""),
	};

	return createPool(
		{
			create: async () => createClient(connectionObject),
			destroy: (client: ClickHouseClient) => client.close(),
		},
		{
			max: 10,
			min: 2,
			idleTimeoutMillis: 30000,
		}
	);
}
