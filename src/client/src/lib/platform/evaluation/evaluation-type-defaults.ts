import { dataCollector } from "@/lib/platform/common";
import { OPENLIT_EVALUATION_TYPE_DEFAULTS_TABLE_NAME } from "./table-details";

const CACHE: Record<string, string> = {};
let cacheLoaded = false;

async function loadDefaults(): Promise<Record<string, string>> {
	if (cacheLoaded && Object.keys(CACHE).length > 0) return CACHE;
	const { data, err } = await dataCollector({
		query: `SELECT id, any(default_prompt) AS default_prompt FROM ${OPENLIT_EVALUATION_TYPE_DEFAULTS_TABLE_NAME} GROUP BY id`,
	});
	if (err || !Array.isArray(data)) return CACHE;
	for (const r of data as Array<{ id: string; default_prompt: string }>) {
		if (r?.id) CACHE[r.id] = r.default_prompt ?? "";
	}
	cacheLoaded = true;
	return CACHE;
}

export async function getEvaluationTypeDefaultPrompt(
	typeId: string
): Promise<string | undefined> {
	const defaults = await loadDefaults();
	return defaults[typeId];
}

export async function getEvaluationTypeDefaultPrompts(): Promise<
	Record<string, string>
> {
	return loadDefaults();
}
