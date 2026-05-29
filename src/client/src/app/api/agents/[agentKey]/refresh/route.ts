import { getAgent } from "@/lib/platform/agents";
import { materializeAgents } from "@/lib/platform/agents/materialize";

/**
 * Synchronous materialization for a single agent. Rate-limited to 1 call /
 * 10 s / agent_key so user-clicks don't accidentally hammer ClickHouse.
 */
const RATE_WINDOW_MS = 10_000;
const lastRefreshAt = new Map<string, number>();

export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ agentKey: string }> }
) {
	const { agentKey } = await params;

	const now = Date.now();
	const last = lastRefreshAt.get(agentKey) || 0;
	if (now - last < RATE_WINDOW_MS) {
		return Response.json(
			{
				error: "Rate limited",
				retryInMs: RATE_WINDOW_MS - (now - last),
			},
			{ status: 429 }
		);
	}
	lastRefreshAt.set(agentKey, now);

	const agent = await getAgent({ agentKey });
	const scope = agent
		? {
				serviceName: agent.service_name,
				environment: agent.environment,
				clusterId: agent.cluster_id,
			}
		: undefined;

	const result = await materializeAgents({
		agentKeyFilter: scope ? undefined : agentKey,
		scope,
	});

	return Response.json({ success: true, result });
}
