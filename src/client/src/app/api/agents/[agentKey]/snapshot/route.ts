import { getAgent } from "@/lib/platform/agents";
import { getLatestVersion } from "@/lib/platform/agents/snapshot";
import { withCacheHeaders } from "../../_cache";

/**
 * Returns the agent + its latest version. Backed by `getAgent` and
 * `getLatestVersion`, each with their own SWR cache. We deliberately do
 * NOT wrap the composite in its own cache key — that would diverge from
 * the table's `/api/agents/[agentKey]` poll path, which already calls
 * `getAgent` directly. Both routes now share `agents:detail:*` so an
 * invalidation on materialize / click reflects in both views together.
 */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ agentKey: string }> }
) {
	const { agentKey } = await params;
	const [agent, version] = await Promise.all([
		getAgent({ agentKey }),
		getLatestVersion(agentKey),
	]);
	if (!agent) {
		return Response.json({ error: "Agent not found" }, { status: 404 });
	}
	return withCacheHeaders({ data: { agent, version } }, "detail");
}
