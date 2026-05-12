/**
 * Single source of truth for what to render in the LLM / Agent observability
 * cells (list view, agent detail Configuration tab, anywhere else that shows
 * enable/disable affordances).
 *
 * Why this exists: before this helper the list cell and the Configuration tab
 * each had their own ad-hoc `isPending` / `enabled` / `direction` logic, with
 * different precedence rules. That meant the same agent could show
 * `Disabling...` in the list and `Enable` in the Configuration tab at the
 * same time — the exact bug that prompted this refactor.
 *
 * Precedence (top wins). Each branch sets `source` so callers / tests can
 * tell *why* the view came out a particular way:
 *
 *   1. `optimistic` — there is a fresh (not expired) optimistic intent for
 *      this agent + feature in the Zustand store. We trust the user's click
 *      and show the spinner immediately, even before the controller has
 *      written a desired-state or action row.
 *   2. `pending_action` — the controller has at least one pod with a
 *      `pending` or `acknowledged` action whose `action_type` matches this
 *      feature. Multi-pod rollup; `podSummary` reports ack/total/pending.
 *   3. `desired_mismatch` — the controller's desired state differs from the
 *      currently observed actual state. Either we're between "click" and
 *      "first action row appearing", or the agent rejected the action and
 *      we're waiting for the controller to retry / surface the error.
 *   4. `steady` — desired and actual agree (or there is nothing actionable);
 *      render the static enable/disable button.
 */

import type { UnifiedAgent } from "@/types/agents";

export type Feature = "llm" | "agent";
export type Direction = "enabling" | "disabling";

export interface OptimisticIntent {
	feature: Feature;
	direction: Direction;
	queuedAt: number;
	/** Wall-clock millis after which the intent should be considered stale. */
	expiresAt: number;
}

export interface PodSummary {
	total: number;
	ack: number;
	pending: number;
}

export interface ObservabilityView {
	/** Best guess of the actual enabled state for this feature. */
	enabled: boolean;
	/** Whether to render a spinner / disable the toggle. */
	transitioning: boolean;
	/** `null` when not transitioning. */
	direction: Direction | null;
	/**
	 * Pod rollup for the Configuration tab to render `ack/total`. `null` for
	 * SDK-only rows or when the controller has no pods for this workload.
	 */
	podSummary: PodSummary | null;
	/**
	 * True when the agent SDK was enabled out-of-band (e.g. baked into the
	 * service image) rather than by the controller. Only meaningful when
	 * `feature === "agent"`; always `false` for `"llm"`.
	 */
	isManual: boolean;
	source: "optimistic" | "pending_action" | "desired_mismatch" | "steady";
}

/**
 * True when the agent observability SDK is `manual` — i.e. the SDK was
 * enrolled out-of-band rather than driven by the controller. We still allow
 * a Disable action in this state, but render the row with a "Manual" badge
 * so operators know the controller didn't put it there.
 */
export function isManualAgentObservability(agent: UnifiedAgent): boolean {
	return agent.agent_observability_status === "manual";
}

const LLM_ACTIONS = new Set<string>(["instrument", "uninstrument"]);
const AGENT_ACTIONS = new Set<string>([
	"enable_python_sdk",
	"disable_python_sdk",
]);

function isFeatureAction(feature: Feature, action: string): boolean {
	return feature === "llm"
		? LLM_ACTIONS.has(action)
		: AGENT_ACTIONS.has(action);
}

function actionDirection(action: string): Direction | null {
	switch (action) {
		case "instrument":
		case "enable_python_sdk":
			return "enabling";
		case "uninstrument":
		case "disable_python_sdk":
			return "disabling";
		default:
			return null;
	}
}

function llmActualEnabled(agent: UnifiedAgent): boolean {
	// Pure SDK-only rows are "always on" from the LLM side — the SDK was
	// enrolled out-of-band (user called `openlit.init` in their code) and
	// there is no controller toggle to flip.
	//
	// For `source='both'` the controller IS managing the workload — the
	// matching SDK traces just happen to be in the 30-minute discovery
	// window. We MUST defer to the controller's `instrumentation_status`
	// here, otherwise a successful Disable click keeps the buttons stuck
	// in "Disable" (i.e. "currently enabled") until the SDK traces age
	// out and the row transitions back to `source='controller'`.
	if (agent.source === "sdk") return true;
	return agent.instrumentation_status === "instrumented";
}

function agentActualEnabled(agent: UnifiedAgent): boolean {
	if (agent.source === "sdk") return true;
	return (
		agent.agent_observability_status === "enabled" ||
		agent.agent_observability_status === "manual"
	);
}

function llmDesiredEnabled(agent: UnifiedAgent): boolean {
	return agent.desired_instrumentation_status === "instrumented";
}

function agentDesiredEnabled(agent: UnifiedAgent): boolean {
	return agent.desired_agent_status === "enabled";
}

function buildPodSummary(agent: UnifiedAgent): PodSummary | null {
	const total = agent.pods_total ?? 0;
	if (total === 0) return null;
	return {
		total,
		ack: agent.pods_acknowledged ?? 0,
		pending: agent.pods_pending ?? 0,
	};
}

export function getObservabilityView(
	agent: UnifiedAgent,
	feature: Feature,
	intent: OptimisticIntent | null,
	now: number = Date.now()
): ObservabilityView {
	const actualEnabled =
		feature === "llm" ? llmActualEnabled(agent) : agentActualEnabled(agent);
	const desiredEnabled =
		feature === "llm" ? llmDesiredEnabled(agent) : agentDesiredEnabled(agent);
	const podSummary = buildPodSummary(agent);
	const isManual = feature === "agent" && isManualAgentObservability(agent);

	// (1) Optimistic — user just clicked. We trust the intent until either it
	// expires or the server's pending_action confirms it (in which case we
	// fall through to the pending_action branch which is also a spinner).
	if (intent && intent.feature === feature && intent.expiresAt > now) {
		return {
			enabled: intent.direction === "enabling",
			transitioning: true,
			direction: intent.direction,
			podSummary,
			isManual,
			source: "optimistic",
		};
	}

	// (2) Server-truth pending action for this feature.
	const pendingActionRaw = (agent.pending_action || "").trim();
	const pendingStatus = agent.pending_action_status;
	const hasServerPending =
		(pendingStatus === "pending" || pendingStatus === "acknowledged") &&
		pendingActionRaw &&
		isFeatureAction(feature, pendingActionRaw);

	if (hasServerPending) {
		const direction = actionDirection(pendingActionRaw);
		return {
			// Spinner button needs a stable "what it'll be next" so the label
			// doesn't flicker between optimistic and pending_action phases.
			enabled: direction === "enabling",
			transitioning: true,
			direction,
			podSummary,
			isManual,
			source: "pending_action",
		};
	}

	// (3) Desired state diverges from actual — usually the brief window
	// between the API write and the first action row, or a controller retry
	// loop. Pure controller-source rows only. SDK / both rows always have
	// `desired_*='none'` (the controller never wrote a desired state, the
	// SDK self-enrolled by emitting traces) which would otherwise pin them
	// permanently in "disabling..." — that's the regression bug.
	const isSdkBacked = agent.source === "sdk" || agent.source === "both";
	if (!isSdkBacked && desiredEnabled !== actualEnabled) {
		return {
			enabled: actualEnabled,
			transitioning: true,
			direction: desiredEnabled ? "enabling" : "disabling",
			podSummary,
			isManual,
			source: "desired_mismatch",
		};
	}

	// (4) Everything agrees — render the static toggle.
	return {
		enabled: actualEnabled,
		transitioning: false,
		direction: null,
		podSummary,
		isManual,
		source: "steady",
	};
}
