import { PromptCompiledInput } from "@/constants/prompts";
import { getAPIKeyInfo } from "../api-keys";
import { validatePromptCompiledInput } from "@/helpers/server/prompt";
import { getSpecificPrompt } from ".";
import { objectEntries } from "@/utils/object";
import { updateDownloadDetails } from "./version";
import { jsonParse } from "@/utils/json";
import { throwIfError } from "@/utils/error";
import getMessage from "@/constants/messages";
import { unescapeString } from "@/utils/string";

function compilePrompt(
	prompt: string,
	variables: Record<string, unknown>
): string {
	return objectEntries(variables).reduce((acc, [key, value]) => {
		return acc.replaceAll(`{{${key}}}`, value as string);
	}, prompt);
}

export async function getCompiledPrompt(
	promptCompiledInput: PromptCompiledInput
) {
	const verifiedInput = validatePromptCompiledInput(promptCompiledInput);
	throwIfError(
		!!(verifiedInput.err || !verifiedInput.success),
		verifiedInput.err || getMessage().MALFORMED_INPUTS
	);

	const [err, apiInfo] = await getAPIKeyInfo({
		apiKey: promptCompiledInput.apiKey,
	});

	throwIfError(
		!!(err || !apiInfo?.databaseConfigId),
		err || getMessage().NO_API_KEY
	);

	const { err: promptErr, data: promptData } = await getSpecificPrompt(
		{
			id: promptCompiledInput.id,
			name: promptCompiledInput.name,
			version: promptCompiledInput.version,
		},
		apiInfo?.databaseConfigId
	);

	const promptObject = (promptData as any)?.[0] || {};

	throwIfError(
		!!(promptErr || !promptObject?.promptId || !promptObject?.version),
		(promptErr as any) || getMessage().NO_PROMPT
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
	promptObject.prompt = unescapeString(promptObject.prompt);

	if (promptCompiledInput.shouldCompile === false) {
		promptObject.compiledPrompt = promptObject.prompt;
	} else {
		promptObject.compiledPrompt = compilePrompt(
			promptObject.prompt,
			promptCompiledInput.variables || {}
		);
	}
	return promptObject;
}

/**
 * Internal variant used by the rule-engine evaluate flow.
 * Accepts a resolved databaseConfigId directly — no API key lookup, no download tracking.
 */
export async function getCompiledPromptByDbConfig({
	id,
	version,
	variables,
	shouldCompile,
	databaseConfigId,
}: {
	id: string;
	version?: string;
	variables?: Record<string, any>;
	shouldCompile?: boolean;
	databaseConfigId?: string;
}) {
	const { err: promptErr, data: promptData } = await getSpecificPrompt(
		{ id, version },
		databaseConfigId
	);

	const promptObject = (promptData as any)?.[0] || {};

	throwIfError(
		!!(promptErr || !promptObject?.promptId || !promptObject?.version),
		(promptErr as any) || getMessage().NO_PROMPT
	);

	promptObject.metaProperties = jsonParse(promptObject.metaProperties);
	promptObject.tags = jsonParse(promptObject.tags);
	promptObject.prompt = unescapeString(promptObject.prompt);

	if (shouldCompile === false) {
		promptObject.compiledPrompt = promptObject.prompt;
	} else {
		promptObject.compiledPrompt = compilePrompt(
			promptObject.prompt,
			variables || {}
		);
	}
	return promptObject;
}
