import { dataCollector, OTEL_TRACES_TABLE_NAME } from "@/lib/platform/common";
import {
	asAgentLoopHit,
	type AgentLoopHit,
} from "./classify";
import {
	agentLoopHitsByGroupSql,
	agentLoopHitsByTraceSql,
} from "./sql";

function asHitMap(
	rows: Array<Record<string, unknown>> | undefined,
	idKey: string
): Map<string, AgentLoopHit> {
	const hits = new Map<string, AgentLoopHit>();
	for (const row of rows || []) {
		const id = String(row[idKey] || "").trim();
		const hit = asAgentLoopHit(row);
		if (!id || !hit) continue;
		hits.set(id, hit);
	}
	return hits;
}

export async function fetchLoopHitsByTraceIds(
	baseWhere: string,
	traceIds: string[],
	databaseConfigId?: string
): Promise<Map<string, AgentLoopHit>> {
	const unique = Array.from(new Set(traceIds.map((id) => id.trim()).filter(Boolean)));
	if (!unique.length || !baseWhere) return new Map();
	const result = await dataCollector(
		{
			query: agentLoopHitsByTraceSql(
				OTEL_TRACES_TABLE_NAME,
				baseWhere,
				unique
			),
		},
		"query",
		databaseConfigId
	);
	if (result.err) return new Map();
	return asHitMap(result.data as Array<Record<string, unknown>>, "TraceId");
}

export async function fetchLoopHitsByGroupIds(
	baseWhere: string,
	groupIds: string[],
	databaseConfigId?: string
): Promise<Map<string, AgentLoopHit>> {
	const unique = Array.from(new Set(groupIds.map((id) => id.trim()).filter(Boolean)));
	if (!unique.length || !baseWhere) return new Map();
	const result = await dataCollector(
		{
			query: agentLoopHitsByGroupSql(
				OTEL_TRACES_TABLE_NAME,
				baseWhere,
				unique
			),
		},
		"query",
		databaseConfigId
	);
	if (result.err) return new Map();
	return asHitMap(result.data as Array<Record<string, unknown>>, "groupId");
}
