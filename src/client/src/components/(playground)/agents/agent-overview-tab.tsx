"use client";

import type { UnifiedAgent } from "@/types/agents";
import AgentMetadataGrid from "./agent-metadata-grid";
import AgentDag from "./agent-dag";

interface AgentOverviewTabProps {
	agent: UnifiedAgent;
	versionHash: string | null;
}

/**
 * Overview tab: top half is the lifted metadata grid (primary model,
 * tools, age, first/last seen, requests 24h); bottom half is the
 * aggregated per-version DAG.
 *
 * Both halves react to `versionHash` — the DAG re-fetches scoped to the
 * version, and version-aware metadata (request counts, etc.) is sourced
 * elsewhere; the lifted grid stays version-agnostic because it shows
 * agent-wide stats from `openlit_agents_summary`.
 */
export default function AgentOverviewTab({
	agent,
	versionHash,
}: AgentOverviewTabProps) {
	return (
		<div className="space-y-5">
			<AgentMetadataGrid agent={agent} />
			<AgentDag agentKey={agent.agent_key} versionHash={versionHash} />
		</div>
	);
}
