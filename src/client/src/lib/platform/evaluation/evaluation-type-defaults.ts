import { dataCollector } from "@/lib/platform/common";
import { consoleLog } from "@/utils/log";
import { OPENLIT_EVALUATION_TYPE_DEFAULTS_TABLE_NAME } from "./table-details";

// Per database config. "" is only the no-id fallback; UI, offline, and
// auto-eval all pass the ClickHouse config id they already resolved.
// Evaluations stay on dataCollector (OpenPlait). An explicit id lets the
// no-session paths use getDBConfigByIdForBackground instead of the user session.
const CACHE = new Map<string, Record<string, string>>();

async function loadDefaults(
	databaseConfigId?: string
): Promise<Record<string, string>> {
	const key = databaseConfigId ?? "";
	const cached = CACHE.get(key);
	if (cached) return cached;

	const { data, err } = await dataCollector(
		{
			query: `SELECT id, any(default_prompt) AS default_prompt FROM ${OPENLIT_EVALUATION_TYPE_DEFAULTS_TABLE_NAME} GROUP BY id`,
		},
		"query",
		databaseConfigId
	);

	if (err || !Array.isArray(data)) {
		// Leave the key uncached so the next evaluation retries. The judge
		// otherwise reports this as "Invalid response format".
		consoleLog("Failed to load evaluation type default prompts", key, err);
		return {};
	}

	const result: Record<string, string> = {};
	for (const r of data as Array<{ id: string; default_prompt: string }>) {
		if (r?.id) result[r.id] = r.default_prompt ?? "";
	}

	// A zero-row read is not a loaded cache. Caching it would pin missing
	// [X evaluation context] blocks until process restart.
	if (Object.keys(result).length > 0) {
		CACHE.set(key, result);
	}
	return result;
}

export async function getEvaluationTypeDefaultPrompt(
	typeId: string,
	databaseConfigId?: string
): Promise<string | undefined> {
	const defaults = await loadDefaults(databaseConfigId);
	return defaults[typeId];
}

export async function getEvaluationTypeDefaultPrompts(
	databaseConfigId?: string
): Promise<Record<string, string>> {
	return loadDefaults(databaseConfigId);
}
