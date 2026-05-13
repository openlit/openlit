/**
 * Table-driven coverage for the precedence rules in `getObservabilityView`.
 *
 * The critical regression case (`desired_agent_status='none'`,
 * `agent_observability_status='enabled'`, no intent, no pending) is the bug
 * that prompted the read-time rollup refactor: previously the list-view
 * cell rendered "Disabling..." because the summary row reported
 * `desired_agent_status='none'` while the SDK was emitting traces. After the
 * server fix that field is sourced from `openlit_controller_desired_states_v2`,
 * and for an SDK-only / both row it stays `'none'` legitimately — so this
 * helper must collapse that back to `steady, enabled` instead of
 * `desired_mismatch`.
 */

import {
	getObservabilityView,
	type Feature,
	type OptimisticIntent,
} from "@/lib/platform/agents/observability-view";
import type { UnifiedAgent } from "@/types/agents";

function makeAgent(overrides: Partial<UnifiedAgent> = {}): UnifiedAgent {
	return {
		agent_key: "k1",
		service_name: "svc",
		environment: "prod",
		cluster_id: "default",
		workload_key: "docker:svc",
		source: "controller",
		controller_service_id: "ctrl-1",
		controller_instance_id: "inst-1",
		primary_model: "",
		models: [],
		providers: [],
		tool_names: [],
		tool_count: 0,
		request_count_24h: 0,
		current_version_hash: "",
		current_version_number: 0,
		sdk_version: "",
		sdk_language: "",
		instrumentation_status: "discovered",
		desired_instrumentation_status: "none",
		agent_observability_status: "",
		desired_agent_status: "none",
		lifecycle_status: "running",
		desired_lifecycle_status: "unknown",
		pending_action: null,
		pending_action_status: null,
		first_seen: "2026-05-12 00:00:00",
		last_seen: "2026-05-12 00:00:00",
		updated_at: "2026-05-12 00:00:00",
		last_materialized_at: "2026-05-12 00:00:00",
		pods_total: 0,
		pods_pending: 0,
		pods_acknowledged: 0,
		...overrides,
	};
}

const FROZEN_NOW = 1_700_000_000_000;

function intent(
	feature: Feature,
	direction: "enabling" | "disabling",
	overrides: Partial<OptimisticIntent> = {}
): OptimisticIntent {
	return {
		feature,
		direction,
		queuedAt: FROZEN_NOW - 1000,
		expiresAt: FROZEN_NOW + 30_000,
		...overrides,
	};
}

describe("getObservabilityView — precedence", () => {
	it("[REGRESSION] both-source with desired_agent_status=none and actual=enabled is steady, not transitioning", () => {
		// Pre-fix this produced `transitioning=true, direction='disabling'`
		// in the list (which is where the user saw "Disabling..." on an
		// already-enabled SDK agent). The server fix changed the summary
		// row but for both-source/SDK rows there is no controller desired
		// state at all, so this helper has to collapse the residual
		// `desired=none, actual=enabled` mismatch back to steady.
		const agent = makeAgent({
			source: "both",
			agent_observability_status: "enabled",
			desired_agent_status: "none",
		});
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.source).toBe("steady");
		expect(view.enabled).toBe(true);
		expect(view.transitioning).toBe(false);
		expect(view.direction).toBeNull();
	});

	it("[REGRESSION] sdk-source LLM row reads enabled without controller fields populated", () => {
		const agent = makeAgent({
			source: "sdk",
			controller_service_id: null,
			controller_instance_id: null,
			instrumentation_status: "instrumented",
		});
		const view = getObservabilityView(agent, "llm", null, FROZEN_NOW);
		expect(view.source).toBe("steady");
		expect(view.enabled).toBe(true);
	});

	it("[optimistic] fresh intent wins over server-truth steady state", () => {
		const agent = makeAgent({
			agent_observability_status: "",
			desired_agent_status: "none",
		});
		const view = getObservabilityView(
			agent,
			"agent",
			intent("agent", "enabling"),
			FROZEN_NOW
		);
		expect(view.source).toBe("optimistic");
		expect(view.transitioning).toBe(true);
		expect(view.direction).toBe("enabling");
		expect(view.enabled).toBe(true);
	});

	it("[optimistic] expired intent is ignored", () => {
		const expired = intent("agent", "enabling", {
			expiresAt: FROZEN_NOW - 1,
		});
		const agent = makeAgent({ desired_agent_status: "none" });
		const view = getObservabilityView(agent, "agent", expired, FROZEN_NOW);
		expect(view.source).toBe("steady");
		expect(view.transitioning).toBe(false);
	});

	it("[optimistic] intent for a different feature does not leak across", () => {
		const llmIntent = intent("llm", "enabling");
		const agent = makeAgent();
		const view = getObservabilityView(agent, "agent", llmIntent, FROZEN_NOW);
		expect(view.source).toBe("steady");
	});

	it("[pending_action] server-reported pending instrument transitions the LLM cell", () => {
		const agent = makeAgent({
			pending_action: "instrument",
			pending_action_status: "pending",
			pods_total: 3,
			pods_pending: 3,
			pods_acknowledged: 0,
		});
		const view = getObservabilityView(agent, "llm", null, FROZEN_NOW);
		expect(view.source).toBe("pending_action");
		expect(view.direction).toBe("enabling");
		expect(view.transitioning).toBe(true);
		expect(view.podSummary).toEqual({ total: 3, ack: 0, pending: 3 });
	});

	it("[pending_action] LLM pending_action does NOT trigger the agent cell", () => {
		const agent = makeAgent({
			pending_action: "instrument",
			pending_action_status: "pending",
			pods_total: 2,
			pods_pending: 2,
		});
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.source).not.toBe("pending_action");
	});

	it("[pending_action] partially acknowledged fan-out surfaces ack/total", () => {
		const agent = makeAgent({
			pending_action: "enable_python_sdk",
			pending_action_status: "pending",
			pods_total: 5,
			pods_pending: 2,
			pods_acknowledged: 3,
		});
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.source).toBe("pending_action");
		expect(view.direction).toBe("enabling");
		expect(view.podSummary).toEqual({ total: 5, ack: 3, pending: 2 });
	});

	it("[desired_mismatch] desired=enabled, actual=disabled for a controller agent", () => {
		const agent = makeAgent({
			agent_observability_status: "disabled",
			desired_agent_status: "enabled",
		});
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.source).toBe("desired_mismatch");
		expect(view.direction).toBe("enabling");
		expect(view.transitioning).toBe(true);
		expect(view.enabled).toBe(false);
	});

	it("[desired_mismatch] desired=none, actual=enabled for a pure controller agent", () => {
		// This is the only case where the mismatch genuinely means
		// "disabling in progress" — pure controller-source (no SDK
		// fallback) with a real desired-state row asking for none.
		const agent = makeAgent({
			source: "controller",
			agent_observability_status: "enabled",
			desired_agent_status: "none",
		});
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.source).toBe("desired_mismatch");
		expect(view.direction).toBe("disabling");
	});

	it("[steady] desired matches actual", () => {
		const agent = makeAgent({
			agent_observability_status: "enabled",
			desired_agent_status: "enabled",
		});
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.source).toBe("steady");
		expect(view.transitioning).toBe(false);
		expect(view.enabled).toBe(true);
	});

	it("[steady] LLM controller row with both instrumentation_status and desired matching", () => {
		const agent = makeAgent({
			instrumentation_status: "instrumented",
			desired_instrumentation_status: "instrumented",
		});
		const view = getObservabilityView(agent, "llm", null, FROZEN_NOW);
		expect(view.source).toBe("steady");
		expect(view.enabled).toBe(true);
	});

	it("[REGRESSION] source='both' LLM after a successful Disable reflects controller state, not always-on", () => {
		// The controller injected the openlit SDK, the user clicked
		// Disable, controller completed the uninstrument action and now
		// reports instrumentation_status='discovered'. The matching SDK
		// traces are still inside the 30-min materializer window so the
		// summary row remains source='both'. UI MUST flip back to "Enable".
		const agent = makeAgent({
			source: "both",
			instrumentation_status: "discovered",
			desired_instrumentation_status: "none",
		});
		const view = getObservabilityView(agent, "llm", null, FROZEN_NOW);
		expect(view.source).toBe("steady");
		expect(view.enabled).toBe(false);
		expect(view.transitioning).toBe(false);
	});

	it("[REGRESSION] source='both' Agent after a successful Disable reflects controller state, not always-on", () => {
		const agent = makeAgent({
			source: "both",
			agent_observability_status: "disabled",
			desired_agent_status: "none",
		});
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.source).toBe("steady");
		expect(view.enabled).toBe(false);
		expect(view.transitioning).toBe(false);
	});

	it("source='sdk' LLM is always-on regardless of instrumentation_status (pure SDK has no controller)", () => {
		const agent = makeAgent({
			source: "sdk",
			instrumentation_status: "discovered",
			desired_instrumentation_status: "none",
		});
		const view = getObservabilityView(agent, "llm", null, FROZEN_NOW);
		expect(view.source).toBe("steady");
		expect(view.enabled).toBe(true);
	});

	it("source='sdk' Agent is always-on regardless of agent_observability_status", () => {
		const agent = makeAgent({
			source: "sdk",
			agent_observability_status: "",
			desired_agent_status: "none",
		});
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.source).toBe("steady");
		expect(view.enabled).toBe(true);
	});
});

describe("getObservabilityView — isManual", () => {
	it("surfaces isManual=true for agent feature when status is manual", () => {
		// A "manual" agent is one where the SDK was self-enrolled (source
		// `both`) — the controller never wrote a desired-state row but the
		// SDK is emitting traces, so we want the steady branch with a
		// Manual badge rendered alongside the Disable button.
		const agent = makeAgent({
			source: "both",
			agent_observability_status: "manual",
		});
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.isManual).toBe(true);
		expect(view.enabled).toBe(true);
		expect(view.source).toBe("steady");
	});

	it("never surfaces isManual for the llm feature", () => {
		const agent = makeAgent({
			source: "both",
			agent_observability_status: "manual",
		});
		const view = getObservabilityView(agent, "llm", null, FROZEN_NOW);
		expect(view.isManual).toBe(false);
	});

	it("isManual=false when agent_observability_status is not manual", () => {
		const agent = makeAgent({
			source: "both",
			agent_observability_status: "enabled",
		});
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.isManual).toBe(false);
	});
});

describe("getObservabilityView — polling signal contract", () => {
	// `pendingKeys` in app/(playground)/agents/page.tsx polls fast as long
	// as *any* of the following resolves to transitioning. These tests pin
	// down the contract so a future refactor of the helper doesn't silently
	// break the polling cadence.
	it("transitioning=true when an LLM pending_action is queued (pods_pending > 0 path)", () => {
		const agent = makeAgent({
			source: "controller",
			pending_action: "instrument",
			pending_action_status: "pending",
			pods_total: 4,
			pods_pending: 4,
			pods_acknowledged: 0,
		});
		expect(getObservabilityView(agent, "llm", null, FROZEN_NOW).transitioning).toBe(true);
	});

	it("transitioning=true on agent feature when controller desired/actual diverge", () => {
		const agent = makeAgent({
			source: "controller",
			agent_observability_status: "disabled",
			desired_agent_status: "enabled",
		});
		expect(getObservabilityView(agent, "agent", null, FROZEN_NOW).transitioning).toBe(true);
	});

	it("transitioning=false for a fully-steady controller row with zero pods pending", () => {
		const agent = makeAgent({
			source: "controller",
			agent_observability_status: "enabled",
			desired_agent_status: "enabled",
			pods_total: 3,
			pods_pending: 0,
			pods_acknowledged: 3,
		});
		expect(getObservabilityView(agent, "agent", null, FROZEN_NOW).transitioning).toBe(false);
		expect(getObservabilityView(agent, "llm", null, FROZEN_NOW).transitioning).toBe(false);
	});
});

describe("getObservabilityView — pod summary", () => {
	it("returns null when pods_total is 0", () => {
		const agent = makeAgent({ pods_total: 0 });
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.podSummary).toBeNull();
	});

	it("returns the pod rollup when pods_total > 0 even without a pending action", () => {
		const agent = makeAgent({
			pods_total: 4,
			pods_pending: 0,
			pods_acknowledged: 0,
			agent_observability_status: "enabled",
			desired_agent_status: "enabled",
		});
		const view = getObservabilityView(agent, "agent", null, FROZEN_NOW);
		expect(view.podSummary).toEqual({ total: 4, ack: 0, pending: 0 });
		expect(view.source).toBe("steady");
	});
});
