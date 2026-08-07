import { createHash, randomUUID } from "node:crypto";
import type { DatabaseConfig } from "@prisma/client";
import {
	OPENPLAIT_API_VERSION,
	type NativeQuery,
} from "@openplait/core";
import {
	ClickHouseAdapter,
	OPENLIT_CLICKHOUSE_DATASETS,
	type ClickHouseAdapterConfig,
} from "@openplait/adapter-clickhouse";
import { DatasourceRegistry, OpenPlaitRuntime } from "@openplait/runtime";
import { constructURL, parseQueryStringToObject } from "@/utils/parser";

export {
	DIRECT_INTELLIGENCE_READ_FEATURES,
	OPENPLAIT_CLICKHOUSE_READ_FEATURES,
	type OpenPlaitClickHouseReadFeature,
} from "./features";
export { openPlaitFramesToRows } from "./frames";
import { openPlaitFramesToRows } from "./frames";
export { normalizeOpenPlaitReadStatement } from "./native";
import { normalizeOpenPlaitReadStatement } from "./native";

const DATASOURCE_KIND = "ClickHouseDatasource";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESULT_ROWS = 100_000;
const DEFAULT_MAX_ROWS_TO_READ = 10_000_000;

interface RuntimeEntry {
	fingerprint: string;
	adapter: ClickHouseAdapter;
	runtime: OpenPlaitRuntime;
	datasourceName: string;
}

const runtimeEntries = new Map<string, RuntimeEntry>();

export interface OpenPlaitClickHouseConnection {
	host: string;
	port: string;
	database: string;
	username: string;
	password?: string | null;
	query?: string | null;
}

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function configFingerprint(dbConfig: DatabaseConfig): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				host: dbConfig.host,
				port: dbConfig.port,
				database: dbConfig.database,
				username: dbConfig.username,
				password: dbConfig.password || "",
				query: dbConfig.query || "",
			})
		)
		.digest("hex");
}

function datasourceName(dbConfig: DatabaseConfig): string {
	return `openlit-clickhouse-${dbConfig.id}`;
}

function connectionConfig(
	connection: OpenPlaitClickHouseConnection
): ClickHouseAdapterConfig {
	return {
		url: constructURL(connection.host, connection.port),
		username: connection.username,
		password: connection.password || "",
		database: connection.database,
		httpHeaders: parseQueryStringToObject(connection.query || ""),
		applicationName: "openlit-openplait",
		allowNativeQueries: true,
		requireTimeRange: false,
		queryTimeoutMs: positiveInteger(
			process.env.OPENPLAIT_CLICKHOUSE_QUERY_TIMEOUT_MS,
			DEFAULT_TIMEOUT_MS
		),
		maxResultRows: positiveInteger(
			process.env.OPENPLAIT_CLICKHOUSE_MAX_RESULT_ROWS,
			DEFAULT_MAX_RESULT_ROWS
		),
		maxRowsToRead: positiveInteger(
			process.env.OPENPLAIT_CLICKHOUSE_MAX_ROWS_TO_READ,
			DEFAULT_MAX_ROWS_TO_READ
		),
		datasets: [...OPENLIT_CLICKHOUSE_DATASETS],
	};
}

async function runtimeFor(dbConfig: DatabaseConfig): Promise<RuntimeEntry> {
	const fingerprint = configFingerprint(dbConfig);
	const current = runtimeEntries.get(dbConfig.id);
	if (current?.fingerprint === fingerprint) return current;
	if (current) await current.adapter.close();

	const adapter = new ClickHouseAdapter(connectionConfig(dbConfig));
	const name = datasourceName(dbConfig);
	const registry = new DatasourceRegistry().register({
		name,
		kind: DATASOURCE_KIND,
		scope: "workspace",
		config: {
			url: constructURL(dbConfig.host, dbConfig.port),
			username: dbConfig.username,
			password: dbConfig.password || "",
			database: dbConfig.database,
			httpHeaders: parseQueryStringToObject(dbConfig.query || ""),
			allowNativeQueries: true,
		},
		adapter,
	});
	const entry = {
		fingerprint,
		adapter,
		runtime: new OpenPlaitRuntime(registry, {
			defaultTimeoutMs: positiveInteger(
				process.env.OPENPLAIT_CLICKHOUSE_QUERY_TIMEOUT_MS,
				DEFAULT_TIMEOUT_MS
			),
		}),
		datasourceName: name,
	};
	runtimeEntries.set(dbConfig.id, entry);
	return entry;
}

function deepestErrorMessage(error: unknown): string {
	let current = error;
	let message = error instanceof Error ? error.message : String(error);
	for (let index = 0; index < 5 && current instanceof Error; index += 1) {
		message = current.message || message;
		current = current.cause;
	}
	return message;
}

function isTransientConnectionError(error: unknown): boolean {
	let current: unknown = error;
	for (let index = 0; index < 8 && current; index += 1) {
		const message =
			current instanceof Error ? current.message : String(current || "");
		const code =
			typeof current === "object" && current && "code" in current
				? String((current as { code?: unknown }).code || "")
				: "";
		if (
			/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|UND_ERR_SOCKET|socket hang up|connection (?:closed|reset)/i.test(
				`${code} ${message}`
			)
		) {
			return true;
		}
		current = current instanceof Error ? current.cause : undefined;
	}
	return false;
}

async function evictRuntime(
	dbConfigId: string,
	expected: RuntimeEntry
): Promise<void> {
	if (runtimeEntries.get(dbConfigId) !== expected) return;
	runtimeEntries.delete(dbConfigId);
	await expected.adapter.close();
}

/** Construct and validate a ClickHouse datasource through OpenPlait before persistence. */
export async function validateOpenPlaitClickHouseConnection(
	connection: OpenPlaitClickHouseConnection
): Promise<void> {
	const adapter = new ClickHouseAdapter(connectionConfig(connection));
	const name = `openlit-connector-validation-${randomUUID()}`;
	const registry = new DatasourceRegistry().register({
		name,
		kind: DATASOURCE_KIND,
		scope: "workspace",
		config: connectionConfig(connection),
		adapter,
	});
	const runtime = new OpenPlaitRuntime(registry, {
		defaultTimeoutMs: positiveInteger(
			process.env.OPENPLAIT_CLICKHOUSE_QUERY_TIMEOUT_MS,
			DEFAULT_TIMEOUT_MS
		),
	});
	const resource: NativeQuery = {
		apiVersion: OPENPLAIT_API_VERSION,
		kind: "Query",
		metadata: { name: "openlit-connector-validation" },
		spec: {
			mode: "native",
			datasource: { kind: DATASOURCE_KIND, name, scope: "workspace" },
			native: { language: "sql", statement: "SELECT 1 AS openplait_connection_ok" },
		},
	};

	try {
		await runtime.execute({
			queries: [resource],
			audit: { requestId: `openlit:connector-validation:${randomUUID()}` },
		});
	} catch (error) {
		throw new Error(
			`OpenPlait ClickHouse validation failed: ${deepestErrorMessage(error)}`,
			{ cause: error }
		);
	} finally {
		await adapter.close();
	}
}

/** Execute a project-scoped, read-only ClickHouse query through OpenPlait. */
export async function executeOpenPlaitRead({
	query,
	dbConfig,
}: {
	query: string;
	dbConfig: DatabaseConfig;
}): Promise<Record<string, unknown>[]> {
	const statement = normalizeOpenPlaitReadStatement(query);
	const execute = async (entry: RuntimeEntry) => {
		const resource: NativeQuery = {
			apiVersion: OPENPLAIT_API_VERSION,
			kind: "Query",
			metadata: { name: "openlit-read" },
			spec: {
				mode: "native",
				datasource: {
					kind: DATASOURCE_KIND,
					name: entry.datasourceName,
					scope: "workspace",
				},
				native: { language: "sql", statement },
			},
		};
		const response = await entry.runtime.execute({
			queries: [resource],
			audit: { requestId: `openlit:${dbConfig.id}:${randomUUID()}` },
		});
		return openPlaitFramesToRows(response.result.frames);
	};

	const first = await runtimeFor(dbConfig);
	try {
		return await execute(first);
	} catch (error) {
		if (!isTransientConnectionError(error)) throw error;
		// @clickhouse/client connections are pooled inside the cached adapter.
		// Recreate that adapter once when the peer resets a stale socket.
		await evictRuntime(dbConfig.id, first);
		return execute(await runtimeFor(dbConfig));
	}
}

/** Test/server-shutdown hook for clients owned by cached OpenPlait adapters. */
export async function closeOpenPlaitRuntimes(): Promise<void> {
	const entries = Array.from(runtimeEntries.values());
	runtimeEntries.clear();
	await Promise.all(entries.map(({ adapter }) => adapter.close()));
}
