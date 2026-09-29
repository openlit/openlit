import { connectorDataCollector, type DataCollectorType } from "../common";
import {
	queryConnectorTraces,
	resolveTracesTableRef,
} from "@/lib/platform/connectors/datasource/clickhouse/direct-read";

/** Qualified `database.otel_traces` for the traces signal ClickHouse binding. */
export async function tracesTableRef(databaseConfigId?: string): Promise<string> {
	return resolveTracesTableRef(databaseConfigId);
}

/** Run trace-table SQL on the direct ClickHouse client (bypasses OpenPlait). */
export async function queryTracesSql(
	query: string,
	databaseConfigId?: string
): Promise<DataCollectorType> {
	return queryConnectorTraces(query, databaseConfigId);
}

/** Convenience for intelligence/cron callers that need traces routing first. */
export async function queryTracesSqlForProject(
	query: string,
	options?: {
		environment?: string | null;
		projectId?: string | null;
		dbConfigId?: string;
	}
): Promise<DataCollectorType> {
	const { resolveCodingAgentsClickHouseDbConfigId } = await import(
		"@/lib/platform/coding-agents/source"
	);
	const routed =
		await resolveCodingAgentsClickHouseDbConfigId({
			environment: options?.environment,
			projectId: options?.projectId,
			dbConfigId: options?.dbConfigId,
		});
	return connectorDataCollector({ query }, "query", routed || options?.dbConfigId);
}
