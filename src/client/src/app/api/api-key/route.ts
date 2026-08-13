import { withAudit } from "@/lib/audit/route";
import { requireCurrentOrganisationPermission } from "@/lib/rbac/current";
import { generateAPIKey, getAllAPIKeys } from "@/lib/platform/api-keys";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/utils/api-response";

export async function GET() {
	const [permissionErr] = await asaw(
		requireCurrentOrganisationPermission("api_key:read")
	);
	if (permissionErr) return errorResponse(permissionErr, "Forbidden", 403);

	const res: any = await getAllAPIKeys();
	return Response.json(res);
}

async function POSTHandler(request: Request) {
	const [permissionErr] = await asaw(
		requireCurrentOrganisationPermission("api_key:create")
	);
	if (permissionErr) return errorResponse(permissionErr, "Forbidden", 403);

	const formData = await request.json();
	const name = formData.name;

	const [err, res]: any = await asaw(generateAPIKey(name));

	if (err) {
		return Response.json(err, {
			status: 400,
		});
	}

	return Response.json(res);
}

export const POST = withAudit(POSTHandler);
