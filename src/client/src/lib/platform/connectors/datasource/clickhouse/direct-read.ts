import asaw from "@/utils/asaw";
import { getDBConfigByIdForBackground } from "@/lib/db-config";
import { connectorDataCollector } from "@/lib/platform/common";
import { qualifiedTracesTable } from "./sql";

/** Resolve the configured traces table reference for connector tree reads. */
export async function resolveTracesTableRef(
	dbConfigId?: string
): Promise<string> {
	if (!dbConfigId) return qualifiedTracesTable();
	const [err, cfg] = await asaw(getDBConfigByIdForBackground({ id: dbConfigId }));
	if (err || !cfg) return qualifiedTracesTable();
	return qualifiedTracesTable(cfg.database);
}

/** Run a connector-owned full-row trace read on the direct ClickHouse client. */
export async function queryConnectorTraces(
	query: string,
	dbConfigId?: string
) {
	return connectorDataCollector({ query }, "query", dbConfigId);
}
