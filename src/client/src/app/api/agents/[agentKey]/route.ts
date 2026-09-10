import { getAgent } from "@/lib/platform/agents";
import { withCacheHeaders } from "../_cache";
import { withRouteAccess } from "@/lib/access/route-access";

async function GETHandler(
	_request: Request,
	{ params }: { params: Promise<{ agentKey: string }> }
) {
	const { agentKey } = await params;
	const agent = await getAgent({ agentKey });
	if (!agent) {
		return Response.json({ error: "Agent not found" }, { status: 404 });
	}
	return withCacheHeaders({ data: agent }, "detail");
}

export const GET = withRouteAccess("observability.read", GETHandler, { requireDbConfig: true });
