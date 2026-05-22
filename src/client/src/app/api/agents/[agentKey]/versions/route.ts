import { POLICY_VERSIONS, swr } from "@/lib/platform/agents/cache";
import { getVersions } from "@/lib/platform/agents/snapshot";
import { withCacheHeaders } from "../../_cache";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ agentKey: string }> }
) {
	const { agentKey } = await params;
	const url = new URL(request.url);
	const limitRaw = url.searchParams.get("limit");
	const limit = limitRaw ? Math.max(1, Math.min(Number(limitRaw), 200)) : 50;

	const cacheKey = `agents:versions:default:${agentKey}:${limit}`;
	const versions = await swr(cacheKey, POLICY_VERSIONS, () =>
		getVersions(agentKey, limit)
	);
	return withCacheHeaders({ data: versions }, "versions");
}
