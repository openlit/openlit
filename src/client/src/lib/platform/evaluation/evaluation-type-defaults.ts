import { dataCollector } from "@/lib/platform/common";
import { OPENLIT_EVALUATION_TYPE_DEFAULTS_TABLE_NAME } from "./table-details";

// Cache keyed by databaseConfigId (or "" for the user-session path).
// This prevents the offline evaluation API path from sharing a cache that
// was populated (or left empty) by the UI user-session path — fixing the
// restart-until-dashboard-opened failure described in issue #1587.
const CACHE = new Map<string, Record<string, string>>();

async function loadDefaults(
	databaseConfigId?: string
): Promise<Record<string, string>> {
	const key = databaseConfigId ?? "";
	if (CACHE.has(key)) return CACHE.get(key)!;

	const { data, err } = await dataCollector(
		{
			query: `SELECT id, any(default_prompt) AS default_prompt FROM ${OPENLIT_EVALUATION_TYPE_DEFAULTS_TABLE_NAME} GROUP BY id`,
		},
		"query",
		databaseConfigId
	);

	if (err || !Array.isArray(data)) {
		// Do not cache a failed load — let the next call retry.
		return CACHE.get(key) ?? {};
	}

	const result: Record<string, string> = {};
	for (const r of data as Array<{ id: string; default_prompt: string }>) {
		if (r?.id) result[r.id] = r.default_prompt ?? "";
	}
	CACHE.set(key, result);
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
