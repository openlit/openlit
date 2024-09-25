import { PromptCompiledInput } from "@/constants/prompts";
import { getCompiledPrompt } from "@/lib/platform/prompt/compiled";
import asaw from "@/utils/asaw";

export async function POST(request: Request) {
	const formData = await request.json();

	const promptInput: PromptCompiledInput = {
		id: formData.id,
		name: formData.name,
		version: formData.version,
		apiKey: formData.apiKey,
		variables: formData.variables || {},
		compile: !!formData.compile,
	};

	const [err, res]: any = await asaw(getCompiledPrompt(promptInput));

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}
