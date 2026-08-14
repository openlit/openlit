import { getAgent } from "@/lib/platform/agents";
import { POLICY_TOOLS, swr } from "@/lib/platform/agents/cache";
import { getAggregateGraph } from "@/lib/platform/agents/aggregate-graph";
import { getVersionWindow } from "@/lib/platform/agents/version-filter";
import { withCacheHeaders } from "../../_cache";

/**
 * GET /api/agents/[agentKey]/graph?versionHash=...
 *
 * Returns the aggregated per-version DAG used by the Overview tab. When
 * `versionHash` is omitted, falls back to a 24h aggregate so the canvas
 * still has something to render before a version is picked.
 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ agentKey: string }> }
) {
	const { agentKey } = await params;
	const url = new URL(request.url);
	const versionHash = url.searchParams.get("versionHash") || undefined;

	const cacheKey = `agents:graph:default:${agentKey}:${versionHash || "all"}`;

	const result = await swr(cacheKey, POLICY_TOOLS, async () => {
		const agent = await getAgent({ agentKey });
		if (!agent) return null;
		const versionFilter = versionHash
			? await getVersionWindow(agentKey, versionHash)
			: null;
		const graph = await getAggregateGraph({
			serviceName: agent.service_name,
			environment: agent.environment,
			versionFilter,
		});
		return { agent, graph, versionFilter };
	});

	if (!result) {
		return Response.json({ error: "Agent not found" }, { status: 404 });
	}
	return withCacheHeaders({ data: result }, "graph");
}
