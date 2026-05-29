"use client";

import { lens } from "@dhmk/zustand-lens";
import type {
	AgentIntentsByKey,
	AgentInstrumentationStore,
	Direction,
	Feature,
} from "@/types/store/agents-instrumentation";

/**
 * Auto-clear safety net for optimistic intents.
 *
 * Reconciliation in `refreshPendingRows` clears the intent the moment the
 * controller-observed state converges to the intent direction, so a healthy
 * fast path doesn't depend on the TTL at all. The TTL is sized to absorb
 * the slow path:
 *   - K8s rolling updates across many pods (image pull + readiness probes)
 *   - Multi-controller fleets where one controller can lag behind
 *   - Default controller `PollInterval` up to 60s, plus a couple of
 *     materializer ticks before the new `agent_observability_status`
 *     surfaces in the rollup
 *
 * 5 minutes is comfortably longer than any healthy rollout and short
 * enough that a truly stuck action leaves the user with a clear next
 * step (the button comes back, they can retry).
 */
export const OPTIMISTIC_INTENT_TTL_MS = 5 * 60_000;

function pruneIntents(intents: AgentIntentsByKey, now: number): AgentIntentsByKey {
	let mutated = false;
	const next: AgentIntentsByKey = {};
	for (const [agentKey, features] of Object.entries(intents)) {
		const nextFeatures: Partial<Record<Feature, AgentIntentsByKey[string][Feature]>> = {};
		let kept = 0;
		for (const [feature, intent] of Object.entries(features || {})) {
			if (!intent) continue;
			if (intent.expiresAt > now) {
				nextFeatures[feature as Feature] = intent;
				kept += 1;
			} else {
				mutated = true;
			}
		}
		if (kept > 0) {
			next[agentKey] = nextFeatures;
		} else if (features && Object.keys(features).length > 0) {
			mutated = true;
		}
	}
	return mutated ? next : intents;
}

export const agentsInstrumentationStoreSlice: AgentInstrumentationStore = lens(
	(setStore, getStore) => ({
		intents: {},

		setIntent: (agentKey: string, feature: Feature, direction: Direction) => {
			const now = Date.now();
			const current = getStore().intents;
			const featureMap = { ...(current[agentKey] || {}) };
			featureMap[feature] = {
				feature,
				direction,
				queuedAt: now,
				expiresAt: now + OPTIMISTIC_INTENT_TTL_MS,
			};
			setStore({
				intents: {
					...current,
					[agentKey]: featureMap,
				},
			});
		},

		clearIntent: (agentKey: string, feature: Feature) => {
			const current = getStore().intents;
			const featureMap = current[agentKey];
			if (!featureMap || !featureMap[feature]) return;
			const nextFeatures = { ...featureMap };
			delete nextFeatures[feature];
			const next = { ...current };
			if (Object.keys(nextFeatures).length === 0) {
				delete next[agentKey];
			} else {
				next[agentKey] = nextFeatures;
			}
			setStore({ intents: next });
		},

		pruneExpired: () => {
			const now = Date.now();
			const current = getStore().intents;
			const pruned = pruneIntents(current, now);
			if (pruned !== current) {
				setStore({ intents: pruned });
			}
		},
	})
);
