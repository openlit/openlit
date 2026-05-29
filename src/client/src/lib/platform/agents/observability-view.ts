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

export type Feature = "llm" | "agent" | "lifecycle";
/**
 * Direction of the in-flight transition.
 *
 * For `llm` and `agent` features: only `enabling` / `disabling` apply.
 * For `lifecycle`:
 *   - `starting`  — Play queued while the workload is stopped.
 *   - `stopping`  — Stop queued while the workload is running.
 *   - `restarting` — Restart queued; the workload will return to `running`.
 *     We expose `restarting` as a distinct direction (rather than reusing
 *     `enabling`) because the UI renders a different spinner glyph and a
 *     different toast for Restart, and the optimistic-intent store wants to
 *     match by exact action.
 */
export type Direction =
	| "enabling"
	| "disabling"
	| "starting"
	| "stopping"
	| "restarting";

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
const LIFECYCLE_ACTIONS = new Set<string>([
	"start_workload",
	"stop_workload",
	"restart_workload",
]);

function isFeatureAction(feature: Feature, action: string): boolean {
	switch (feature) {
		case "llm":
			return LLM_ACTIONS.has(action);
		case "agent":
			return AGENT_ACTIONS.has(action);
		case "lifecycle":
			return LIFECYCLE_ACTIONS.has(action);
	}
}

function actionDirection(action: string): Direction | null {
	switch (action) {
		case "instrument":
		case "enable_python_sdk":
			return "enabling";
		case "uninstrument":
		case "disable_python_sdk":
			return "disabling";
		case "start_workload":
			return "starting";
		case "stop_workload":
			return "stopping";
		case "restart_workload":
			return "restarting";
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

function lifecycleActualEnabled(agent: UnifiedAgent): boolean {
	// "Enabled" for lifecycle means "the workload is up". `restarting`
	// counts as enabled because the workload will be back in seconds and
	// we don't want the Stop button to disappear during the bounce.
	return (
		agent.lifecycle_status === "running" ||
		agent.lifecycle_status === "restarting"
	);
}

function lifecycleDesiredEnabled(agent: UnifiedAgent): boolean {
	// Default to running when the desired-state is unknown. Most rows
	// start out without an explicit lifecycle desired state -- only Stop
	// writes one. Treating unknown as `running` matches the user's
	// expectation that an undiscovered workload is "on" by default.
	return agent.desired_lifecycle_status !== "stopped";
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

function featureActualEnabled(feature: Feature, agent: UnifiedAgent): boolean {
	switch (feature) {
		case "llm":
			return llmActualEnabled(agent);
		case "agent":
			return agentActualEnabled(agent);
		case "lifecycle":
			return lifecycleActualEnabled(agent);
	}
}

function featureDesiredEnabled(feature: Feature, agent: UnifiedAgent): boolean {
	switch (feature) {
		case "llm":
			return llmDesiredEnabled(agent);
		case "agent":
			return agentDesiredEnabled(agent);
		case "lifecycle":
			return lifecycleDesiredEnabled(agent);
	}
}

export function getObservabilityView(
	agent: UnifiedAgent,
	feature: Feature,
	intent: OptimisticIntent | null,
	now: number = Date.now()
): ObservabilityView {
	const actualEnabled = featureActualEnabled(feature, agent);
	const desiredEnabled = featureDesiredEnabled(feature, agent);
	const podSummary = buildPodSummary(agent);
	const isManual = feature === "agent" && isManualAgentObservability(agent);

	// (1) Optimistic — user just clicked. We trust the intent until either it
	// expires or the server's pending_action confirms it (in which case we
	// fall through to the pending_action branch which is also a spinner).
	if (intent && intent.feature === feature && intent.expiresAt > now) {
		// For lifecycle: starting/restarting are conceptually "enabled"
		// (workload will be up); stopping is "disabled" (workload will
		// be down).
		const optimisticEnabled =
			intent.direction === "enabling" ||
			intent.direction === "starting" ||
			intent.direction === "restarting";
		return {
			enabled: optimisticEnabled,
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
		const willEnable =
			direction === "enabling" ||
			direction === "starting" ||
			direction === "restarting";
		return {
			// Spinner button needs a stable "what it'll be next" so the label
			// doesn't flicker between optimistic and pending_action phases.
			enabled: willEnable,
			transitioning: true,
			direction,
			podSummary,
			isManual,
			source: "pending_action",
		};
	}

	// (3) Desired state diverges from actual — usually the brief window
	// between the API write and the first action row, or a controller retry
	// loop. Pure controller-source rows only for `llm`/`agent`; lifecycle
	// rows always go through controller-managed actions so the SDK-backed
	// short-circuit does not apply. SDK / both rows always have
	// `desired_*='none'` (the controller never wrote a desired state, the
	// SDK self-enrolled by emitting traces) which would otherwise pin them
	// permanently in "disabling..." — that's the regression bug.
	const isSdkBacked = agent.source === "sdk" || agent.source === "both";
	const skipForSdk = isSdkBacked && feature !== "lifecycle";
	if (!skipForSdk && desiredEnabled !== actualEnabled) {
		let direction: Direction;
		if (feature === "lifecycle") {
			direction = desiredEnabled ? "starting" : "stopping";
		} else {
			direction = desiredEnabled ? "enabling" : "disabling";
		}
		return {
			enabled: actualEnabled,
			transitioning: true,
			direction,
			podSummary,
			isManual,
			source: "desired_mismatch",
		};
	}

	// (3b) Lifecycle-specific in-flight signal. The controller stamps
	// `openlit.lifecycle.status = "restarting"` on the in-memory service
	// for the heartbeat immediately following a Restart. Both
	// optimistic intent and pending_action will have already covered
	// the user-initiated case, but a second browser tab that loads
	// after the click would otherwise miss the spinner entirely.
	// Treating actual=='restarting' as transitioning here is the
	// failsafe that keeps the icon set consistent across tabs.
	if (feature === "lifecycle" && agent.lifecycle_status === "restarting") {
		return {
			enabled: true,
			transitioning: true,
			direction: "restarting",
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
