import {
	getRequestEnvironment,
	OPENLIT_CONTEXT_HEADERS,
} from "@/constants/openlit-context";
import { getDBConfigByUser } from "@/lib/db-config";
import { resolveSignalSource } from "@/lib/telemetry-source";
import getMessage from "@/constants/messages";
import {
	requireCodingAgentAuth,
	type CodingAgentAuth,
} from "./auth";

/**
 * Seed / coding-agent dashboard SQL relies on ClickHouse-only constructs
 * (session rollups, greatest(), coding_agent.* attributes). Never bridge
 * these through Tempo/Jaeger structured inference.
 */
export function isCodingAgentClickHouseSql(sql: string): boolean {
	return /coding_agent\.|claude_code\.|coding.?agent/i.test(sql);
}

/**
 * Resolve the ClickHouse that coding-agents SQL should query for an
 * environment (no HTTP request). Prefer traces when it is ClickHouse;
 * otherwise intelligence. Returns null when neither binding is CH.
 */
export async function resolveCodingAgentsClickHouseDbConfigId(options?: {
	environment?: string | null;
	/** Sessionless callers (cron / materializer) must pass project scope. */
	projectId?: string | null;
	dbConfigId?: string;
}): Promise<string | null> {
	const environment = options?.environment ?? undefined;
	const sourceOptions = {
		environment,
		...(options?.projectId !== undefined ? { projectId: options.projectId } : {}),
		...(options?.dbConfigId ? { dbConfigId: options.dbConfigId } : {}),
	};

	const traces = await resolveSignalSource("traces", sourceOptions);
	if (
		traces.hasSource &&
		traces.descriptor.type === "clickhouse" &&
		traces.descriptor.dbConfigId
	) {
		return traces.descriptor.dbConfigId;
	}

	const intelligence = await resolveSignalSource("intelligence", sourceOptions);
	if (
		intelligence.hasSource &&
		intelligence.descriptor.type === "clickhouse" &&
		intelligence.descriptor.dbConfigId
	) {
		return intelligence.descriptor.dbConfigId;
	}

	return null;
}

/**
 * Resolve the ClickHouse that coding-agents SQL should query for this request.
 *
 * Prefer env signal routing (traces CH → intelligence CH). The ambient
 * `x-openlit-database-config-id` header from `getData` is the project's
 * current credential vault — often a Tempo-linked config — and must not
 * override signal routing or the Sessions list and user picker diverge.
 *
 * The header is only used as a last-resort project-scoped ClickHouse when
 * neither traces nor intelligence resolves to ClickHouse.
 */
export async function resolveCodingAgentsDatabaseConfigId(
	request: Request
): Promise<string> {
	const environment = getRequestEnvironment(request);
	const routedId = await resolveCodingAgentsClickHouseDbConfigId({
		environment,
	});
	if (routedId) {
		return routedId;
	}

	const requestedId = request.headers.get(
		OPENLIT_CONTEXT_HEADERS.databaseConfigId
	);
	if (requestedId) {
		const available = await getDBConfigByUser();
		const selected = Array.isArray(available)
			? available.find((database) => database.id === requestedId)
			: undefined;
		if (!selected?.id) {
			throw new Error(getMessage().CODING_AGENTS_DB_NOT_IN_PROJECT);
		}
		return selected.id;
	}

	throw new Error(getMessage().CODING_AGENTS_REQUIRES_CLICKHOUSE);
}

/** Auth + env-routed ClickHouse for coding-agents query helpers. */
export async function requireCodingAgentQueryContext(
	request: Request
): Promise<CodingAgentAuth & { dbConfigId: string }> {
	const auth = await requireCodingAgentAuth();
	const dbConfigId = await resolveCodingAgentsDatabaseConfigId(request);
	return { ...auth, dbConfigId };
}
