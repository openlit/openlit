import { useRootStore } from "@/store";
import type { RootStore } from "@/types/store/root";
import type { OptimisticIntent, Feature } from "@/types/store/agents-instrumentation";

export const getAgentIntents = (state: RootStore) =>
	state.agentsInstrumentation.intents;

export const getSetAgentIntent = (state: RootStore) =>
	state.agentsInstrumentation.setIntent;

export const getClearAgentIntent = (state: RootStore) =>
	state.agentsInstrumentation.clearIntent;

export const getPruneExpiredAgentIntents = (state: RootStore) =>
	state.agentsInstrumentation.pruneExpired;

/**
 * Returns the optimistic intent for `(agentKey, feature)` or `null`. Live
 * subscription — callers re-render on any change to the underlying map.
 */
export function useAgentIntent(
	agentKey: string,
	feature: Feature
): OptimisticIntent | null {
	return useRootStore((state) => {
		const features = state.agentsInstrumentation.intents[agentKey];
		if (!features) return null;
		return features[feature] || null;
	});
}
