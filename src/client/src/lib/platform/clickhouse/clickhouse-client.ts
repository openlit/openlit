import { constructURL, parseQueryStringToObject } from "@/utils/parser";
import { ClickHouseClient, createClient } from "@clickhouse/client";
import { DatabaseConfig } from "@prisma/client";
import { createPool, Pool } from "generic-pool";
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
	create: async (): Promise<ClickHouseClient> => createClient(connectionObject),
	destroy: (client: ClickHouseClient) => client.close(),
});

const pools = new Map<
	string,
	{ connectionKey: string; pool: Pool<ClickHouseClient> }
>();

async function closePool(pool: Pool<ClickHouseClient>): Promise<void> {
	await pool.drain();
	await pool.clear();
}

/**
 * Returns the pool shared by every query of one database config. Clients carry
 * the tenant's `additional_table_filters`, so pools are never shared across
 * configs, and a change to the connection or tenant settings replaces the pool.
 */
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

	const connectionKey = JSON.stringify(connectionObject);
	const current = pools.get(dbConfig.id);
	if (current?.connectionKey === connectionKey) return current.pool;
	// A factory that fails makes generic-pool retry in a microtask loop, which
	// freezes the process before any acquire timeout can fire, so a config that
	// cannot build a client has to throw here instead. The client only parses
	// its config, it connects on the first request.
	createClient(connectionObject).close().catch(() => undefined);
	// Drain waits for in-flight queries; nobody is left to report a close failure.
	if (current) closePool(current.pool).catch(() => undefined);

	const pool = createPool(getClickHouseFactoryOptions(connectionObject), {
		max: 20,
		min: 0,
		idleTimeoutMillis: 30000,
		evictionRunIntervalMillis: 30000,
		maxWaitingClients: 200,
		acquireTimeoutMillis: 30000,
	});
	pools.set(dbConfig.id, { connectionKey, pool });
	return pool;
}
