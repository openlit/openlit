import { getVersionWindow } from "@/lib/platform/agents/version-filter";
import { withCacheHeaders } from "../../../../_cache";

/**
 * Resolves an agent version into the `VersionFilter` shape expected by
 * `AgentScopeProvider` — namely `{versionHash, firstSeen, lastSeen,
 * hasAttributeSpans}`. The page hits this whenever `?versionHash=` changes so
 * downstream dashboard/requests queries can scope to that version's traffic.
 */
export async function GET(
	_request: Request,
	{
		params,
	}: { params: Promise<{ agentKey: string; versionHash: string }> }
) {
	const { agentKey, versionHash } = await params;
	const filter = await getVersionWindow(agentKey, versionHash);
	if (!filter) {
		return Response.json({ error: "Version not found" }, { status: 404 });
	}
	return withCacheHeaders({ data: filter }, "versions");
}
