import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { generateAPIKey, getAllAPIKeys } from "@/lib/platform/api-keys";
import asaw from "@/utils/asaw";

async function GETHandler() {
	const res: any = await getAllAPIKeys();
	return Response.json(res);
}

async function POSTHandler(request: Request) {
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

export const GET = withCurrentOrganisationPermission(
	"api_key:read",
	GETHandler
);
export const POST = withAudit(
	withCurrentOrganisationPermission("api_key:create", POSTHandler)
);
