import { withAudit } from "@/lib/audit/route";
import { requireCurrentOrganisationPermission } from "@/lib/rbac/current";
import { shareDBConfig } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/utils/api-response";

async function POSTHandler(request: Request) {
	const [permissionErr] = await asaw(
		requireCurrentOrganisationPermission("db_config:share")
	);
	if (permissionErr) return errorResponse(permissionErr, "Forbidden", 403);

	const formData = await request.json();
	const shareArray = formData.shareArray;
	const id = formData.id;
	const [err, res] = await asaw(shareDBConfig({ id, shareArray }));
	if (err)
		return Response.json(err, {
			status: 400,
		});
	return Response.json(res);
}

export const POST = withAudit(POSTHandler);
