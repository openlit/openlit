
jest.mock("@/lib/platform/controller", () => ({
	getServiceById: jest.fn(),
	getControllerInstanceById: jest.fn(),
	getControllerIdsForWorkload: jest.fn(),
	getControllerConfig: jest.fn(),
	getFeatureDesiredStates: jest.fn(),
	queueAction: jest.fn(),
	updateFeatureDesiredState: jest.fn(),
}));

import {
	getServiceById,
	getControllerInstanceById,
	getControllerIdsForWorkload,
	getControllerConfig,
	getFeatureDesiredStates,
	queueAction,
	updateFeatureDesiredState,
} from "@/lib/platform/controller";
import agentHandler, {
	buildAgentStatusResponse,
} from "@/lib/platform/controller/features/agent";
import { KNOWN_ACTIONS } from "@/types/controller";

const mockGetServiceById = getServiceById as jest.Mock;
const mockGetInstance = getControllerInstanceById as jest.Mock;
const mockGetControllerIds = getControllerIdsForWorkload as jest.Mock;
const mockGetConfig = getControllerConfig as jest.Mock;
const mockGetDesired = getFeatureDesiredStates as jest.Mock;
const mockQueueAction = queueAction as jest.Mock;
const mockUpdateDesired = updateFeatureDesiredState as jest.Mock;

function capablePythonService(
	overrides: Record<string, unknown> = {},
	instanceOverrides: Record<string, unknown> = {}
) {
	mockGetServiceById.mockResolvedValue({
		data: [
			{
				id: "svc-1",
				workload_key: "linux:python-ai-app",
				cluster_id: "default",
				service_name: "python-ai-app",
				namespace: "default",
				controller_instance_id: "ctrl-1",
				language_runtime: "python",
				resource_attributes: {
					"openlit.agent_observability.status": "disabled",
				},
				...overrides,
			},
		],
	});
	mockGetInstance.mockResolvedValue({
		data: [
			{
				mode: "linux",
				resource_attributes: {
					"controller.capabilities": "python_sdk_injection_linux_systemd_v1",
				},
				...instanceOverrides,
			},
		],
	});
	mockGetControllerIds.mockResolvedValue({ data: [] });
	mockQueueAction.mockResolvedValue({ data: "ok" });
	mockUpdateDesired.mockResolvedValue({ data: "ok" });
	mockGetConfig.mockResolvedValue({ data: [] });
	mockGetDesired.mockResolvedValue({ data: [] });
}

beforeEach(() => {
	jest.clearAllMocks();
});

describe("agent controller feature", () => {
	it("validates enable/disable/status only", () => {
		expect(agentHandler.validatePayload("enable", {})).toBeNull();
		expect(agentHandler.validatePayload("disable", {})).toBeNull();
		expect(agentHandler.validatePayload("status", {})).toBeNull();
		expect(agentHandler.validatePayload("push", {})).toMatch(/Unknown operation/);
	});

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

	it("normalizes node runtime alias and uses desired config when non-empty", () => {
		const actions = agentHandler.reconcile(
			[
				{
					workload_key: "wk-1",
					instrumentation_status: "discovered",
					language_runtime: "node",
					resource_attributes: {},
				},
			],
			new Map([
				[
					"wk-1",
					{
						workload_key: "wk-1",
						cluster_id: "default",
						feature: "agent",
						desired_status: "enabled",
						config: '{"custom":true}',
						updated_at: "t",
					},
				],
			])
		);

		expect(actions[0].payload).toBe('{"custom":true}');
	});

	it("skips unsupported runtimes and missing desired states", () => {
		const actions = agentHandler.reconcile(
			[
				{
					workload_key: "wk-java",
					instrumentation_status: "discovered",
					language_runtime: "java",
				},
				{
					workload_key: "wk-skip",
					instrumentation_status: "discovered",
					language_runtime: "python",
				},
			],
			new Map([
				[
					"wk-java",
					{
						workload_key: "wk-java",
						cluster_id: "default",
						feature: "agent",
						desired_status: "enabled",
						config: "{}",
						updated_at: "t",
					},
				],
			])
		);

		expect(actions).toEqual([]);
	});

	it("returns 404 when service is missing", async () => {
		mockGetServiceById.mockResolvedValue({ data: [] });
		const res = await agentHandler.applyOperation("svc-1", "status", {});
		expect(res.status).toBe(404);
	});

	it("returns 400 for unsupported language runtime", async () => {
		mockGetServiceById.mockResolvedValue({
			data: [
				{
					language_runtime: "java",
					controller_instance_id: "ctrl-1",
				},
			],
		});
		const res = await agentHandler.applyOperation("svc-1", "enable", {});
		expect(res.status).toBe(400);
	});

	it("returns status payload for status operation", async () => {
		capablePythonService();
		const res = await agentHandler.applyOperation("svc-1", "status", {});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({
			supported: true,
			mode: "linux",
			status: "disabled",
			service: "python-ai-app",
		});
	});

	it("returns 409 when controller lacks agent capability", async () => {
		capablePythonService({}, {
			mode: "kubernetes",
			resource_attributes: { "controller.capabilities": "lifecycle_kubernetes_v1" },
		});
		const res = await agentHandler.applyOperation("svc-1", "enable", {});
		expect(res.status).toBe(409);
	});

	it("returns 500 when workload_key is missing on enable", async () => {
		capablePythonService({ workload_key: "" });
		const res = await agentHandler.applyOperation("svc-1", "enable", {});
		expect(res.status).toBe(500);
	});

	it("queues ENABLE_AGENT with export overrides from controller config", async () => {
		capablePythonService();
		mockGetControllerIds.mockResolvedValue({
			data: [{ controller_instance_id: "ctrl-2" }],
		});
		mockGetConfig.mockResolvedValue({
			data: [
				{
					config: JSON.stringify({
						export: {
							otlp_endpoint: "http://collector:4318",
							otlp_protocol: "http/protobuf",
							otlp_headers: { "x-api-key": "k" },
							otlp_traces_endpoint: "http://t",
							otlp_metrics_endpoint: "http://m",
							otlp_logs_endpoint: "http://l",
						},
					}),
				},
			],
		});

		const res = await agentHandler.applyOperation(
			"svc-1",
			"enable",
			{ enable_http_instrumentation: false },
			"db-1"
		);
		const body = await res.json();

		expect(body.status).toBe("queued");
		expect(mockUpdateDesired).toHaveBeenCalledWith(
			"linux:python-ai-app",
			"default",
			"agent",
			"enabled",
			"{}",
			"db-1"
		);
		const payload = JSON.parse(mockQueueAction.mock.calls[0][3]);
		expect(payload).toMatchObject({
			target_runtime: "python",
			otlp_endpoint: "http://collector:4318",
			otlp_protocol: "http/protobuf",
			enable_http_instrumentation: false,
		});
	});

	it("allows payload otlp_endpoint to override config", async () => {
		capablePythonService();
		mockGetConfig.mockResolvedValue({
			data: [
				{
					config: JSON.stringify({
						export: { otlp_endpoint: "http://from-config" },
					}),
				},
			],
		});

		await agentHandler.applyOperation("svc-1", "enable", {
			otlp_endpoint: "http://from-payload",
		});

		const payload = JSON.parse(mockQueueAction.mock.calls[0][3]);
		expect(payload.otlp_endpoint).toBe("http://from-payload");
	});

	it("tolerates invalid controller config JSON on enable", async () => {
		capablePythonService();
		mockGetConfig.mockResolvedValue({ data: [{ config: "{not-json" }] });

		const res = await agentHandler.applyOperation("svc-1", "enable", {});
		expect(res.status).toBe(200);
	});

	it("queues DISABLE_AGENT and falls back to service controller", async () => {
		capablePythonService({ cluster_id: undefined, namespace: undefined });

		const res = await agentHandler.applyOperation("svc-1", "disable", {});
		const body = await res.json();

		expect(body.message).toMatch(/removal queued/);
		expect(mockUpdateDesired).toHaveBeenCalledWith(
			"linux:python-ai-app",
			"default",
			"agent",
			"none",
			"{}",
			undefined
		);
		expect(mockQueueAction).toHaveBeenCalledWith(
			"ctrl-1",
			KNOWN_ACTIONS.DISABLE_AGENT,
			"linux:python-ai-app",
			expect.any(String),
			undefined
		);
	});

	it("supports kubernetes and docker capability exact matches", async () => {
		capablePythonService(
			{ language_runtime: "nodejs" },
			{
				mode: "kubernetes",
				resource_attributes: {
					"controller.capabilities": "nodejs_sdk_injection_kubernetes_v1",
				},
			}
		);
		const res = await agentHandler.applyOperation("svc-1", "disable", {});
		expect(res.status).toBe(200);

		capablePythonService(
			{},
			{
				mode: "docker",
				resource_attributes: {
					"controller.capabilities": "python_sdk_injection_docker_v1",
				},
			}
		);
		const res2 = await agentHandler.applyOperation("svc-1", "disable", {});
		expect(res2.status).toBe(200);
	});

	it("returns 500 on unexpected errors", async () => {
		mockGetServiceById.mockRejectedValue(new Error("boom"));
		const res = await agentHandler.applyOperation("svc-1", "status", {});
		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: "boom" });
	});

	it("uses fallback error message for non-Error throws", async () => {
		mockGetServiceById.mockRejectedValue({});
		const res = await agentHandler.applyOperation("svc-1", "status", {});
		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({
			error: "Agent operation failed",
		});
	});
});

describe("buildAgentStatusResponse", () => {
	beforeEach(() => {
		mockGetDesired.mockResolvedValue({ data: [] });
	});

	it("marks automatable false for user-scoped systemd", async () => {
		const status = await buildAgentStatusResponse(
			{
				service_name: "app",
				workload_key: "wk-1",
				language_runtime: "python",
				resource_attributes: { "systemd.scope": "user" },
			},
			true,
			"linux"
		);
		expect(status.automatable).toBe(false);
		expect(status.reason).toMatch(/User-scoped systemd/);
	});

	it("marks automatable false when docker metadata is missing", async () => {
		const status = await buildAgentStatusResponse(
			{
				service_name: "app",
				language_runtime: "python",
				resource_attributes: {},
			},
			true,
			"docker"
		);
		expect(status.automatable).toBe(false);
		expect(status.reason).toMatch(/Docker container metadata/);
	});

	it("marks automatable false for existing_openlit source", async () => {
		const status = await buildAgentStatusResponse(
			{
				service_name: "app",
				language_runtime: "python",
				resource_attributes: {
					"openlit.agent_observability.status": "enabled",
					"openlit.agent_observability.source": "existing_openlit",
				},
			},
			true,
			"linux"
		);
		expect(status.automatable).toBe(false);
		expect(status.reason).toMatch(/not controller-managed/);
	});

	it("uses preflight reason when unsupported and no attr reason", async () => {
		const docker = await buildAgentStatusResponse(
			{ service_name: "app", language_runtime: "python", resource_attributes: {} },
			false,
			"docker"
		);
		expect(docker.reason).toMatch(/Docker Agent Observability/);

		const linux = await buildAgentStatusResponse(
			{ service_name: "app", language_runtime: "nodejs", resource_attributes: {} },
			false,
			"linux"
		);
		expect(linux.reason).toMatch(/JavaScript\/TypeScript/);

		const other = await buildAgentStatusResponse(
			{ service_name: "app", language_runtime: "python", resource_attributes: {} },
			false,
			"kubernetes"
		);
		expect(other.reason).toMatch(/does not advertise/);
	});

	it("detects naked pods and transitioning desired state", async () => {
		mockGetDesired.mockResolvedValue({
			data: [{ desired_status: "enabled" }],
		});

		const status = await buildAgentStatusResponse(
			{
				service_name: "app",
				namespace: "ns",
				workload_key: "wk-1",
				cluster_id: "c1",
				language_runtime: "python",
				resource_attributes: {
					"openlit.agent_observability.status": "disabled",
					"k8s.workload.kind": "Pod",
					"openlit.is_containerized": "true",
				},
			},
			true,
			"kubernetes",
			"db-1"
		);

		expect(status).toMatchObject({
			is_naked_pod: true,
			transitioning: true,
			desired_status: "enabled",
			is_containerized: true,
			namespace: "ns",
			workload_kind: "Pod",
		});
	});

	it("flags manual status and unsupported runtime reason", async () => {
		const status = await buildAgentStatusResponse(
			{
				service_name: "app",
				language_runtime: "go",
				resource_attributes: {
					"openlit.agent_observability.status": "manual",
					"openlit.observability.reason":
						"Agent observability is only available for Python and JavaScript/TypeScript services",
				},
			},
			false,
			"linux"
		);
		expect(status.enabled).toBe(true);
		expect(status.is_manual).toBe(true);
		expect(status.supported).toBe(false);
		expect(status.reason).toMatch(/only available for Python/);
	});
});
