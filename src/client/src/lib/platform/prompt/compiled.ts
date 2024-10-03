import { PromptCompiledInput } from "@/constants/prompts";
import { getAPIKeyInfo } from "./api-keys";
import { validatePromptCompiledInput } from "@/helpers/prompt";
import { getSpecificPrompt } from ".";
import { objectEntries } from "@/utils/object";
import { updateDownloadDetails } from "./version";
import { jsonParse } from "@/utils/json";

export async function getCompiledPrompt(
	promptCompiledInput: PromptCompiledInput
) {
	const verifiedInput = validatePromptCompiledInput(promptCompiledInput);
	if (verifiedInput.err || !verifiedInput.success)
		throw new Error(
			verifiedInput.err || "Malformed input! Please check the docs"
		);

	const [err, apiInfo] = await getAPIKeyInfo({
		apiKey: promptCompiledInput.apiKey,
	});

	if (err || !apiInfo?.databaseConfigId)
		throw new Error(err || "No such apiKey exists!");

	const { err: promptErr, data: promptData } = await getSpecificPrompt(
		{
			id: promptCompiledInput.id,
			name: promptCompiledInput.name,
			version: promptCompiledInput.version,
		},
		apiInfo?.databaseConfigId
	);

	const promptObject = (promptData as any)?.[0] || {};

	if (promptErr || !promptObject?.promptId || !promptObject?.version)
		throw new Error(
			(promptErr as any) || "No such prompt exists or isn't released yet!"
		);

	await updateDownloadDetails(
		{
			versionId: promptObject.versionId,
			promptId: promptObject.promptId,
			metaProperties: {
				...(promptCompiledInput.downloadMetaProperties || {}),
				apiKeyId: apiInfo.id,
			},
			downloadSource: promptCompiledInput.downloadSource || "api",
		},
		apiInfo?.databaseConfigId
	);

	promptObject.metaProperties = jsonParse(promptObject.metaProperties);
	promptObject.tags = jsonParse(promptObject.tags);

	if (promptCompiledInput.compile === false) {
		return promptObject;
	} else {
		promptObject.compiledPrompt = objectEntries(
			promptCompiledInput.variables || {}
		).reduce((acc, [key, value]) => {
			acc = acc.replaceAll(`{{${key}}}`, value);
			return acc;
		}, promptObject.prompt);

		return promptObject;
	}
}
