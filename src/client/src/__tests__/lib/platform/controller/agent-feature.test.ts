jest.mock("@/lib/platform/controller", () => ({
	getServiceById: jest.fn(),
	getControllerInstanceById: jest.fn(),
	getControllerIdsForWorkload: jest.fn(),
	getControllerConfig: jest.fn(),
	getFeatureDesiredStates: jest.fn(),
	queueAction: jest.fn(),
	updateFeatureDesiredState: jest.fn(),
}));

import agentHandler from "@/lib/platform/controller/features/agent";
import { KNOWN_ACTIONS } from "@/types/controller";

describe("agent controller feature", () => {
	it("queues nodejs runtime payloads for JavaScript/TypeScript services", () => {
		const actions = agentHandler.reconcile(
			[
				{
					workload_key: "k8s:default:deployment/js-ai-app",
					instrumentation_status: "discovered",
					language_runtime: "nodejs",
					resource_attributes: {
						"openlit.agent_observability.status": "disabled",
					},
				},
			],
			new Map([
				[
					"k8s:default:deployment/js-ai-app",
					{
						workload_key: "k8s:default:deployment/js-ai-app",
						cluster_id: "default",
						feature: "agent",
						desired_status: "enabled",
						config: "{}",
						updated_at: "2026-06-30 00:00:00",
					},
				],
			])
		);

		expect(actions).toHaveLength(1);
		expect(actions[0].actionType).toBe(KNOWN_ACTIONS.ENABLE_AGENT);
		expect(JSON.parse(actions[0].payload)).toMatchObject({
			target_runtime: "nodejs",
			instrumentation_profile: "controller_managed",
			duplicate_policy: "block_if_existing_otel_detected",
			observability_scope: "agent",
		});
	});

	it("keeps python runtime payloads for existing Python services", () => {
		const actions = agentHandler.reconcile(
			[
				{
					workload_key: "linux:python-ai-app",
					instrumentation_status: "discovered",
					language_runtime: "python",
					resource_attributes: {
						"openlit.agent_observability.status": "enabled",
					},
				},
			],
			new Map([
				[
					"linux:python-ai-app",
					{
						workload_key: "linux:python-ai-app",
						cluster_id: "default",
						feature: "agent",
						desired_status: "none",
						config: "{}",
						updated_at: "2026-06-30 00:00:00",
					},
				],
			])
		);

		expect(actions).toHaveLength(1);
		expect(actions[0].actionType).toBe(KNOWN_ACTIONS.DISABLE_AGENT);
		expect(JSON.parse(actions[0].payload).target_runtime).toBe("python");
	});
});
