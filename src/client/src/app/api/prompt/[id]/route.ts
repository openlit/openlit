import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { deletePrompt } from "@/lib/platform/prompt";

async function DELETEHandler(_: Request, context: any) {
	const { id } = context.params;
	const [err, res] = await deletePrompt(id);
	if (err) {
		return Response.json(err, {
			status: 400,
		});
	}

	return Response.json(res);
}

export const DELETE = withAudit(withCurrentOrganisationPermission("prompt:delete", DELETEHandler));
