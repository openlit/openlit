import type { Direction, Feature, OptimisticIntent } from "@/lib/platform/agents/observability-view";

export type { Direction, Feature, OptimisticIntent };

/**
 * Optimistic intents are keyed by `agentKey` then `feature` so the same
 * agent can carry independent LLM and Agent click state without one
 * stomping the other.
 */
export type AgentIntentsByKey = Record<
	string,
	Partial<Record<Feature, OptimisticIntent>>
>;

export type AgentInstrumentationStore = {
	intents: AgentIntentsByKey;
	setIntent: (
		agentKey: string,
		feature: Feature,
		direction: Direction
	) => void;
	clearIntent: (agentKey: string, feature: Feature) => void;
	pruneExpired: () => void;
};
