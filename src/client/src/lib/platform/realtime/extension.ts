import type {
	RealtimeFindingTransition,
	RealtimeFindingView,
	RealtimeRule,
} from "./types";

/**
 * Extension point for additional realtime rules. OpenLIT ships only the
 * built-in rule pack, so this returns no rules.
 */
export async function getExtensionRealtimeRules(): Promise<RealtimeRule[]> {
	return [];
}

/**
 * Extension point invoked after a finding opens, reopens, or resolves.
 * OpenLIT keeps findings in-app only, so this is a no-op.
 */
export async function onRealtimeFinding(
	_finding: RealtimeFindingView,
	_transition: RealtimeFindingTransition
): Promise<void> {
	return;
}
