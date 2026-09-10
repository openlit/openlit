import { SERVER_EVENTS } from "@/constants/events";
import getMessage from "@/constants/messages";
import { PromptCompiledInput } from "@/constants/prompts";
import { resolveSdkIntelligenceDatabaseConfig } from "@/helpers/server/sdk-intelligence";
import { getCompiledPrompt } from "@/lib/platform/prompt/compiled";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";

const CORS_HEADERS =
	"Content-Type, Authorization, x-openlit-organisation-id, x-openlit-project-id, x-openlit-environment, x-openlit-database-config-id";

export async function POST(request: Request) {
	const startTimestamp = Date.now();
	const authorizationHeader = request.headers.get("Authorization") || "";
	let apiKey: string = "";
	if (authorizationHeader.startsWith("Bearer ")) {
		apiKey = authorizationHeader.replace(/^Bearer /, "");
	} else {
		return Response.json({
			err: getMessage().NO_API_KEY,
			res: null,
		});
	}

	const [resolveErr, resolved] = await resolveSdkIntelligenceDatabaseConfig(
		request,
		apiKey
	);
	if (resolveErr || !resolved) {
		return Response.json({
			err: resolveErr || getMessage().NO_API_KEY,
			res: null,
		});
	}

	const formData = await request.json();

	const promptInput: PromptCompiledInput = {
		id: formData.id,
		name: formData.name,
		version: formData.version,
		apiKey,
		variables: formData.variables || {},
		shouldCompile: !!formData.shouldCompile,
		downloadMetaProperties: formData.metaProperties,
		downloadSource: formData.source,
		databaseConfigId: resolved.databaseConfigId,
	};

	const [err, res]: any = await asaw(getCompiledPrompt(promptInput));
	PostHogServer.fireEvent({
		event: err
			? SERVER_EVENTS.PROMPT_SDK_FETCH_FAILURE
			: SERVER_EVENTS.PROMPT_SDK_FETCH_SUCCESS,
		properties: {
			downloadSource: formData.source,
			resolveVia: resolved.via,
		},
		startTimestamp,
	});

	return Response.json({
		err,
		res,
	});
}

export async function OPTIONS() {
	return new Response(null, {
		status: 200,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": CORS_HEADERS,
		},
	});
}
