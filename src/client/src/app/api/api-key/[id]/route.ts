import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { deleteAPIKey } from "@/lib/platform/api-keys/index";
import asaw from "@/utils/asaw";

async function DELETEHandler(_: Request, context: any) {
	const { id } = context.params;
	const [err, res] = await deleteAPIKey(id);
	if (err) {
		return Response.json(err, {
			status: 400,
		});
	}

	return Response.json(res);
}

export const DELETE = withAudit(
	withCurrentOrganisationPermission("api_key:delete", DELETEHandler)
);
