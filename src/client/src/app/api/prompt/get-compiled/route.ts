import getMessage from "@/constants/messages";
import { PromptCompiledInput } from "@/constants/prompts";
import { getCompiledPrompt } from "@/lib/platform/prompt/compiled";
import asaw from "@/utils/asaw";

export async function POST(request: Request) {
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

	const formData = await request.json();

	const promptInput: PromptCompiledInput = {
		id: formData.id,
		name: formData.name,
		version: formData.version,
		apiKey,
		variables: formData.variables || {},
		compile: !!formData.compile,
		downloadMetaProperties: formData.metaProperties,
		downloadSource: formData.source,
	};

	const [err, res]: any = await asaw(getCompiledPrompt(promptInput));

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
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		},
	});
}
