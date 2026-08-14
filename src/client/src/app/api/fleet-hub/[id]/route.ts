import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { getAgentByInstanceId } from "@/lib/platform/fleet-hub";

async function GETHandler(_: Request, context: any) {
	const { id } = context.params;
	const res = await getAgentByInstanceId(id);
	return Response.json(res);
}

export const GET = withCurrentOrganisationPermission("fleet_hub:read", GETHandler);
