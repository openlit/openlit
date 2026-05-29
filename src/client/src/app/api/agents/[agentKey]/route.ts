import { getAgent } from "@/lib/platform/agents";
import { withCacheHeaders } from "../_cache";

export async function GET(
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
