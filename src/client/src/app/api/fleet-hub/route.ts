import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { getAllAgents } from "@/lib/platform/fleet-hub";

async function GETHandler() {
	const res: any = await getAllAgents();
	return Response.json(res);
}

export const GET = withCurrentOrganisationPermission("fleet_hub:read", GETHandler);
