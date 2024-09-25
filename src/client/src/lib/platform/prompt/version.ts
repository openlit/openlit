import { PromptDownloadInput, PromptUpdate } from "@/constants/prompts";
import { dataCollector } from "../common";
import {
	OPENLIT_PROMPT_VERSIONS_TABLE_NAME,
	OPENLIT_PROMPT_VERSION_DOWNLOADS_TABLE_NAME,
} from "./table-details";
import { consoleLog } from "@/utils/log";
import { getCurrentUser } from "@/lib/session";
import { jsonStringify } from "@/utils/json";

export async function upsertPromptVersion(promptInput: PromptUpdate) {
	const user = await getCurrentUser();

	if (!user) throw new Error("Unauthorized user!");

	let versionErr;
	let versionData;

	if (promptInput.versionId) {
		const updateValues = [
			`updated_by = '${user.email}'`,
			promptInput.version && "version = '" + promptInput.version + "'",
			promptInput.status && "status = '" + promptInput.status + "'",
			promptInput.prompt && "prompt = '" + promptInput.prompt + "'",
			promptInput.tags && "tags = '" + jsonStringify(promptInput.tags) + "'",
			promptInput.metaProperties &&
				"meta_properties = '" + jsonStringify(promptInput.metaProperties) + "'",
		];
		const updateQuery = `
      ALTER TABLE ${OPENLIT_PROMPT_VERSIONS_TABLE_NAME}
      UPDATE 
        ${updateValues.filter((e) => e).join(" , ")}
      WHERE version_id = '${promptInput.versionId}'`;
		const { err, data } = await dataCollector(
			{
				query: updateQuery,
			},
			"exec"
		);

		versionErr = err;
		versionData = data;
	} else {
		const { err, data } = await dataCollector(
			{
				table: OPENLIT_PROMPT_VERSIONS_TABLE_NAME,
				values: [
					{
						prompt_id: promptInput.promptId,
						updated_by: user.email,
						version: promptInput.version,
						status: promptInput.status,
						prompt: promptInput.prompt,
						tags: jsonStringify(promptInput.tags),
						meta_properties: jsonStringify(promptInput.metaProperties),
					},
				],
			},
			"insert"
		);
		versionErr = err;
		versionData = data;
	}

	if (versionErr || !(versionData as { query_id: unknown })?.query_id)
		throw new Error(
			(versionErr as any).toString() || "Version cannot be saved"
		);

	return "Prompt Version saved successfully!";
}

export async function updateDownloadDetails(
	promptDownloadInput: PromptDownloadInput
) {
	const { err, data } = await dataCollector(
		{
			table: OPENLIT_PROMPT_VERSION_DOWNLOADS_TABLE_NAME,
			values: [
				{
					prompt_id: promptDownloadInput.promptId,
					version_id: promptDownloadInput.versionId,
					meta_properties: jsonStringify(promptDownloadInput.metaProperties),
					download_source: promptDownloadInput.downloadSource,
				},
			],
		},
		"insert"
	);

	if (err || !(data as any)?.query_id)
		consoleLog(err || "Download info cannot be saved!");
	return true;
}
