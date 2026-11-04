import { constructURL, parseQueryStringToObject } from "@/utils/parser";
import { ClickHouseClient, createClient } from "@clickhouse/client";
import { DatabaseConfig } from "@prisma/client";
import { createPool, Pool } from "generic-pool";
import asaw from "@/utils/asaw";
import { tenantReadFilterSettings } from "./tenant-read-filter";

interface ClickHouseConnectionInfo {
	username: string;
	password: string;
	url: string;
	database: string;
	http_headers: Record<string, string>;
	clickhouse_settings?: Record<string, string>;
}

const getClickHouseFactoryOptions = (
	connectionObject: ClickHouseConnectionInfo
) => ({
	create: async (): Promise<ClickHouseClient> => {
		return new Promise(async (resolve) => {
			const client: ClickHouseClient = createClient(connectionObject);
			return resolve(client);
		});
	},
	destroy: (client: ClickHouseClient) => client.close(),
	validate: (client: ClickHouseClient): Promise<boolean> => {
		return new Promise(async (resolve, reject) => {
			const [err, result] = await asaw(client.ping());
			if (err || !result.success) {
				client.close();
				return reject(result.error?.toString() || "Unable to ping the db");
			}

			return resolve(true);
		});
	},
});

export default function createClickhousePool(
	dbConfig: DatabaseConfig
): Pool<ClickHouseClient> {
	const tenantSettings = tenantReadFilterSettings(dbConfig);
	const connectionObject: ClickHouseConnectionInfo = {
		username: dbConfig.username,
		password: dbConfig.password || "",
		url: constructURL(dbConfig.host, dbConfig.port),
		database: dbConfig.database,
		http_headers: parseQueryStringToObject(dbConfig.query || ""),
		...(tenantSettings ? { clickhouse_settings: tenantSettings } : {}),
	};

	return createPool(getClickHouseFactoryOptions(connectionObject), {
		max: 20,
		min: 5,
		idleTimeoutMillis: 30000,
		maxWaitingClients: 5,
		testOnBorrow: true,
		acquireTimeoutMillis: 5000,
	});
}
