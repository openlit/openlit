import { withAudit } from "@/lib/audit/route";
import { requireCurrentOrganisationPermission } from "@/lib/rbac/current";
import { deleteAPIKey } from "@/lib/platform/api-keys/index";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/utils/api-response";

async function DELETEHandler(_: Request, context: any) {
	const [permissionErr] = await asaw(
		requireCurrentOrganisationPermission("api_key:delete")
	);
	if (permissionErr) return errorResponse(permissionErr, "Forbidden", 403);

	const { id } = context.params;
	const [err, res] = await deleteAPIKey(id);
	if (err) {
		return Response.json(err, {
			status: 400,
		});
	}

	return Response.json(res);
}

export const DELETE = withAudit(DELETEHandler);
