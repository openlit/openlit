import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { PromptUpdate } from "@/constants/prompts";
import { upsertPromptVersion } from "@/lib/platform/prompt/version";
import asaw from "@/utils/asaw";

async function POSTHandler(request: Request) {
	const formData = await request.json();

	const promptInput: PromptUpdate = {
		versionId: formData.versionId,
		promptId: formData.promptId,
		prompt: formData.prompt,
		version: formData.version,
		status: formData.status,
		tags: formData.tags,
		metaProperties: formData.metaProperties,
	};

	const [err, res]: any = await asaw(upsertPromptVersion(promptInput));

	if (err) {
		return Response.json(err, {
			status: 400,
		});
	}

	return Response.json(res);
}

export const POST = withAudit(withCurrentOrganisationPermission("prompt:update", POSTHandler));
