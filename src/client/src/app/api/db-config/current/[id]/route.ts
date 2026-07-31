import { withAudit } from "@/lib/audit/route";
import { requireCurrentOrganisationPermission } from "@/lib/rbac/current";
import { setCurrentDBConfig } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/utils/api-response";

async function POSTHandler(_: Request, context: any) {
	const [permissionErr] = await asaw(
		requireCurrentOrganisationPermission("db_config:select")
	);
	if (permissionErr) return errorResponse(permissionErr, "Forbidden", 403);

	const { id } = context.params;
	const [err, res] = await asaw(setCurrentDBConfig(id));
	if (err)
		return Response.json(err, {
			status: 400,
		});
	return Response.json(res);
}

export const POST = withAudit(POSTHandler);
