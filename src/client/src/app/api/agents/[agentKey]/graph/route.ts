import { getAgent } from "@/lib/platform/agents";
import { POLICY_EMPTY_GRAPH, POLICY_TOOLS, swr } from "@/lib/platform/agents/cache";
import { getAggregateGraph } from "@/lib/platform/agents/aggregate-graph";
import { getVersionWindow } from "@/lib/platform/agents/version-filter";
import { withCacheHeaders } from "../../_cache";
import { withRouteAccess } from "@/lib/access/route-access";

/**
 * GET /api/agents/[agentKey]/graph?versionHash=...
 *
 * Returns the aggregated per-version DAG used by the Overview tab. When
 * `versionHash` is omitted, falls back to a 24h aggregate so the canvas
 * still has something to render before a version is picked.
 */
async function GETHandler(
	request: Request,
	{ params }: { params: Promise<{ agentKey: string }> }
) {
	const { agentKey } = await params;
	const url = new URL(request.url);
	const versionHash = url.searchParams.get("versionHash") || undefined;

	// v3: empty Tempo/Jaeger samples use a short TTL — v2 cached empties for 5m.
	const cacheKey = `agents:graph:v3:${agentKey}:${versionHash || "all"}`;

	const result = await swr(
		cacheKey,
		POLICY_TOOLS,
		async () => {
			const agent = await getAgent({ agentKey });
			if (!agent) return null;
			const versionFilter = versionHash
				? await getVersionWindow(agentKey, versionHash)
				: null;
			const startParam = url.searchParams.get("start");
			const endParam = url.searchParams.get("end");
			const timeRange =
				startParam && endParam
					? { start: new Date(startParam), end: new Date(endParam) }
					: undefined;
			const graph = await getAggregateGraph({
				serviceName: agent.service_name,
				environment: agent.environment,
				versionFilter,
				timeRange,
			});
			return { agent, graph, versionFilter };
		},
		{
			policyFor: (value) =>
				value?.graph &&
				value.graph.nodes.length === 0 &&
				value.graph.edges.length === 0
					? POLICY_EMPTY_GRAPH
					: POLICY_TOOLS,
		}
	);

	if (!result) {
		return Response.json({ error: "Agent not found" }, { status: 404 });
	}
	const emptyGraph =
		result.graph.nodes.length === 0 && result.graph.edges.length === 0;
	return withCacheHeaders({ data: result }, emptyGraph ? "graphEmpty" : "graph");
}

export const GET = withRouteAccess("observability.read", GETHandler, { requireDbConfig: true });
