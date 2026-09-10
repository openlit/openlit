import { POLICY_TOOLS, swr } from "@/lib/platform/agents/cache";
import { getLatestVersion } from "@/lib/platform/agents/snapshot";
import { withCacheHeaders } from "../../_cache";
import { withRouteAccess } from "@/lib/access/route-access";

async function GETHandler(
	_request: Request,
	{ params }: { params: Promise<{ agentKey: string }> }
) {
	const { agentKey } = await params;
	const cacheKey = `agents:tools:default:${agentKey}`;
	const tools = await swr(cacheKey, POLICY_TOOLS, async () => {
		const version = await getLatestVersion(agentKey);
		return version?.tools || [];
	});
	return withCacheHeaders({ data: tools }, "versions");
}

export const GET = withRouteAccess("observability.read", GETHandler, { requireDbConfig: true });
