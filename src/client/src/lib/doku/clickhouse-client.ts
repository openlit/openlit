// clickhouseService.js
import { parseClickHouseConnectionString } from "@/utils/parser";
import { ClickHouseClient, createClient } from "@clickhouse/client";
import { createPool, Pool } from "generic-pool";

export default function createClickhousePool(
	connectionString: string
): Pool<ClickHouseClient> {
	const connectionObject = parseClickHouseConnectionString(connectionString);
	return createPool(
		{
			create: async () => createClient(connectionObject),
			destroy: (client: ClickHouseClient) => client.close(),
		},
		{
			max: 10, // Adjust based on your server capacity and requirements
			min: 2, // Start with a minimum number of connections
			idleTimeoutMillis: 30000, // Adjust based on your workload and server characteristics
		}
	);
}
