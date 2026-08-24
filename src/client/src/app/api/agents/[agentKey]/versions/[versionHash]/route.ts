import { POLICY_VERSIONS, swr } from "@/lib/platform/agents/cache";
import { getVersion } from "@/lib/platform/agents/snapshot";
import { withCacheHeaders } from "../../../_cache";
import { withRouteAccess } from "@/lib/access/route-access";

async function GETHandler(
	_request: Request,
	{
		params,
	}: {
		params: Promise<{ agentKey: string; versionHash: string }>;
	}
) {
	const { agentKey, versionHash } = await params;
	const cacheKey = `agents:version:default:${agentKey}:${versionHash}`;
	const version = await swr(cacheKey, POLICY_VERSIONS, () =>
		getVersion(agentKey, versionHash)
	);
	if (!version) {
		return Response.json({ error: "Version not found" }, { status: 404 });
	}
	return withCacheHeaders({ data: version }, "versions");
}

export const GET = withRouteAccess("observability.read", GETHandler, { requireDbConfig: true });
