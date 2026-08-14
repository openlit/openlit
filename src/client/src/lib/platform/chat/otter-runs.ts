import { randomUUID } from "crypto";
import { dataCollector } from "../common";
import { OPENLIT_OTTER_RUNS_TABLE } from "./table-details";
import Sanitizer from "@/utils/sanitizer";

export type OtterRunType = "prompt_improvement";

export async function saveOtterRun(
	{
		runType,
		targetType,
		targetId = "",
		inputSnapshot = "",
		resultJson = "{}",
		summary = "",
		modelProvider = "",
		modelName = "",
		promptTokens = 0,
		completionTokens = 0,
		cost = 0,
		meta = {},
	}: {
		runType: OtterRunType;
		targetType: string;
		targetId?: string;
		inputSnapshot?: string;
		resultJson?: string;
		summary?: string;
		modelProvider?: string;
		modelName?: string;
		promptTokens?: number;
		completionTokens?: number;
		cost?: number;
		meta?: Record<string, unknown>;
	},
	databaseConfigId?: string
): Promise<{ data?: string; err?: unknown }> {
	const id = randomUUID();
	const { err } = await dataCollector(
		{
			table: OPENLIT_OTTER_RUNS_TABLE,
			values: [
				{
					id,
					run_type: Sanitizer.sanitizeValue(runType),
					target_type: Sanitizer.sanitizeValue(targetType),
					target_id: Sanitizer.sanitizeValue(targetId),
					input_snapshot: Sanitizer.sanitizeValue(inputSnapshot),
					result_json: Sanitizer.sanitizeValue(resultJson),
					summary: Sanitizer.sanitizeValue(summary),
					model_provider: Sanitizer.sanitizeValue(modelProvider),
					model_name: Sanitizer.sanitizeValue(modelName),
					prompt_tokens: promptTokens,
					completion_tokens: completionTokens,
					cost,
					meta: Sanitizer.sanitizeValue(JSON.stringify(meta || {})),
				},
			],
		},
		"insert",
		databaseConfigId
	);

	if (err) return { err };
	return { data: id };
}
