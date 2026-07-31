import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { PromptInput } from "@/constants/prompts";
import { createPrompt } from "@/lib/platform/prompt";
import asaw from "@/utils/asaw";

async function POSTHandler(request: Request) {
	const formData = await request.json();

	const promptInput: PromptInput = {
		name: formData.name,
		prompt: formData.prompt,
		version: formData.version,
		status: formData.status,
		tags: formData.tags,
		metaProperties: formData.metaProperties,
	};

	const [err, res]: any = await asaw(createPrompt(promptInput));

	if (err) {
		return Response.json(err, {
			status: 400,
		});
	}

	return Response.json(res);
}

export const POST = withAudit(withCurrentOrganisationPermission("prompt:create", POSTHandler));
