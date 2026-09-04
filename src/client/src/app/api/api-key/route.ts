import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { generateAPIKey, getAllAPIKeys } from "@/lib/platform/api-keys";
import asaw from "@/utils/asaw";
import { MIDDLEWARE_DATABASE_CONFIG_HEADER } from "@/constants/openlit-context";

async function GETHandler(request: Request) {
	const databaseConfigId =
		request.headers?.get?.(MIDDLEWARE_DATABASE_CONFIG_HEADER)?.trim() ||
		undefined;
	const res: any = await getAllAPIKeys(databaseConfigId);
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
