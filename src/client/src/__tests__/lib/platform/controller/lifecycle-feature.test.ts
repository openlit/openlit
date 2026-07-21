
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
	getFeatureDesiredStates,
	queueAction,
	updateFeatureDesiredState,
} from "@/lib/platform/controller";
import lifecycleHandler from "@/lib/platform/controller/features/lifecycle";
import { KNOWN_ACTIONS } from "@/types/controller";

const mockGetServiceById = getServiceById as jest.Mock;
const mockGetInstance = getControllerInstanceById as jest.Mock;
const mockGetControllerIds = getControllerIdsForWorkload as jest.Mock;
const mockGetDesired = getFeatureDesiredStates as jest.Mock;
const mockQueueAction = queueAction as jest.Mock;
const mockUpdateDesired = updateFeatureDesiredState as jest.Mock;

function mockCapableInstance(
	mode: string,
	capabilities: string,
	overrides: Record<string, unknown> = {}
) {
	mockGetServiceById.mockResolvedValue({
		data: [
			{
				id: "svc-1",
				workload_key: "wk-1",
				cluster_id: "default",
				service_name: "app",
				namespace: "ns",
				controller_instance_id: "ctrl-1",
				resource_attributes: {},
				...overrides,
			},
		],
	});
	mockGetInstance.mockResolvedValue({
		data: [
			{
				mode,
				resource_attributes: { "controller.capabilities": capabilities },
			},
		],
	});
	mockGetControllerIds.mockResolvedValue({ data: [] });
	mockQueueAction.mockResolvedValue({ data: "ok" });
	mockUpdateDesired.mockResolvedValue({ data: "ok" });
}

beforeEach(() => {
	jest.clearAllMocks();
});

describe("lifecycle feature", () => {
	it("validates start/stop/restart only", () => {
		expect(lifecycleHandler.validatePayload("start", {})).toBeNull();
		expect(lifecycleHandler.validatePayload("stop", {})).toBeNull();
		expect(lifecycleHandler.validatePayload("restart", {})).toBeNull();
		expect(lifecycleHandler.validatePayload("enable", {})).toMatch(
			/Unknown operation/
		);
	});

	it("returns 404 when service is missing", async () => {
		mockGetServiceById.mockResolvedValue({ data: [] });
		const res = await lifecycleHandler.applyOperation("svc-1", "stop", {});
		expect(res.status).toBe(404);
	});

	it("returns 500 when workload_key is missing", async () => {
		mockGetServiceById.mockResolvedValue({
			data: [{ controller_instance_id: "ctrl-1", workload_key: "" }],
		});
		const res = await lifecycleHandler.applyOperation("svc-1", "stop", {});
		expect(res.status).toBe(500);
	});

	it("returns 409 when controller lacks lifecycle capability", async () => {
		mockCapableInstance("kubernetes", "python_sdk_injection_kubernetes_v1");
		const res = await lifecycleHandler.applyOperation("svc-1", "stop", {});
		expect(res.status).toBe(409);
	});

	it("queues STOP_WORKLOAD when capable", async () => {
		mockCapableInstance("kubernetes", "lifecycle_kubernetes_v1");
		mockGetControllerIds.mockResolvedValue({
			data: [{ controller_instance_id: "ctrl-2" }],
		});

		const res = await lifecycleHandler.applyOperation("svc-1", "stop", {}, "db-1");
		const body = await res.json();

		expect(body).toEqual({
			status: "queued",
			action: KNOWN_ACTIONS.STOP_WORKLOAD,
			controllers: 1,
		});
		expect(mockUpdateDesired).toHaveBeenCalledWith(
			"wk-1",
			"default",
			"lifecycle",
			"stopped",
			"{}",
			"db-1"
		);
		expect(mockQueueAction).toHaveBeenCalledWith(
			"ctrl-2",
			KNOWN_ACTIONS.STOP_WORKLOAD,
			"wk-1",
			"{}",
			"db-1"
		);
	});

	it("queues RESTART_WORKLOAD without updating desired state", async () => {
		mockCapableInstance("docker", "lifecycle_docker_v1");

		const res = await lifecycleHandler.applyOperation("svc-1", "restart", {});
		const body = await res.json();

		expect(body.action).toBe(KNOWN_ACTIONS.RESTART_WORKLOAD);
		expect(mockUpdateDesired).not.toHaveBeenCalled();
		expect(mockQueueAction).toHaveBeenCalledWith(
			"ctrl-1",
			KNOWN_ACTIONS.RESTART_WORKLOAD,
			"wk-1",
			"{}",
			undefined
		);
	});

	it("supports linux prefix capabilities", async () => {
		mockCapableInstance("linux", "lifecycle_linux_systemd_v1,other");
		const res = await lifecycleHandler.applyOperation("svc-1", "restart", {});
		expect(res.status).toBe(200);
	});

	it("defaults mode to linux when instance is missing", async () => {
		mockGetServiceById.mockResolvedValue({
			data: [
				{
					workload_key: "wk-1",
					service_name: "app",
					controller_instance_id: "ctrl-1",
					resource_attributes: { "systemd.unit": "app.service" },
				},
			],
		});
		mockGetInstance.mockResolvedValue({ data: [] });
		mockGetControllerIds.mockResolvedValue({ data: null });
		mockGetDesired.mockResolvedValue({ data: [] });

		const res = await lifecycleHandler.applyOperation("svc-1", "start", {});
		// no lifecycle_linux_* capability on empty instance
		expect(res.status).toBe(409);
	});

	it("rejects start for linux bare process without snapshot", async () => {
		mockCapableInstance("linux", "lifecycle_linux_bare_v1", {
			resource_attributes: {},
		});
		mockGetDesired.mockResolvedValue({ data: [{ feature: "lifecycle", config: "{}" }] });

		const res = await lifecycleHandler.applyOperation("svc-1", "start", {});
		expect(res.status).toBe(409);
		await expect(res.json()).resolves.toMatchObject({
			error: expect.stringContaining("No saved snapshot"),
		});
	});

	it("rejects start for k8s naked pod without snapshot", async () => {
		mockCapableInstance("kubernetes", "lifecycle_kubernetes_v1", {
			resource_attributes: { "k8s.workload.kind": "Pod" },
		});
		mockGetDesired.mockResolvedValue({ data: [] });

		const res = await lifecycleHandler.applyOperation("svc-1", "start", {});
		expect(res.status).toBe(409);
	});

	it("starts with snapshot for naked pod / bare process", async () => {
		mockCapableInstance("linux", "lifecycle_linux_bare_v1");
		mockGetDesired.mockResolvedValue({
			data: [{ feature: "lifecycle", config: '{"exe":"/bin/app"}' }],
		});

		const res = await lifecycleHandler.applyOperation("svc-1", "start", {}, "db-1");
		const body = await res.json();

		expect(body.action).toBe(KNOWN_ACTIONS.START_WORKLOAD);
		expect(mockQueueAction).toHaveBeenCalledWith(
			"ctrl-1",
			KNOWN_ACTIONS.START_WORKLOAD,
			"wk-1",
			'{"exe":"/bin/app"}',
			"db-1"
		);
	});

	it("allows start without snapshot for systemd units", async () => {
		mockCapableInstance("linux", "lifecycle_linux_systemd_v1", {
			resource_attributes: { "systemd.unit": "app.service" },
		});
		mockGetDesired.mockResolvedValue({ data: [] });

		const res = await lifecycleHandler.applyOperation("svc-1", "start", {});
		expect(res.status).toBe(200);
		expect(mockQueueAction).toHaveBeenCalledWith(
			"ctrl-1",
			KNOWN_ACTIONS.START_WORKLOAD,
			"wk-1",
			"{}",
			undefined
		);
	});

	it("allows start without snapshot for controlled k8s workloads", async () => {
		mockCapableInstance("kubernetes", "lifecycle_kubernetes_v1", {
			resource_attributes: { "k8s.workload.kind": "Deployment" },
		});
		mockGetDesired.mockResolvedValue({ data: [{ feature: "other", config: "{}" }] });

		const res = await lifecycleHandler.applyOperation("svc-1", "start", {});
		expect(res.status).toBe(200);
	});

	it("returns 500 on unexpected errors", async () => {
		mockGetServiceById.mockRejectedValue(new Error("boom"));
		const res = await lifecycleHandler.applyOperation("svc-1", "stop", {});
		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: "boom" });
	});

	it("uses fallback error message for non-Error throws", async () => {
		mockGetServiceById.mockRejectedValue({});
		const res = await lifecycleHandler.applyOperation("svc-1", "stop", {});
		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({
			error: "Lifecycle operation failed",
		});
	});

	describe("reconcile", () => {
		it("emits START when desired running and actual stopped", () => {
			const actions = lifecycleHandler.reconcile(
				[
					{
						workload_key: "wk-1",
						instrumentation_status: "discovered",
						resource_attributes: {
							"openlit.lifecycle.status": "stopped",
						},
					},
				],
				new Map([
					[
						"wk-1",
						{
							workload_key: "wk-1",
							cluster_id: "default",
							feature: "lifecycle",
							desired_status: "running",
							config: '{"snap":1}',
							updated_at: "t",
						},
					],
				])
			);

			expect(actions).toEqual([
				{
					actionType: KNOWN_ACTIONS.START_WORKLOAD,
					serviceKey: "wk-1",
					payload: '{"snap":1}',
				},
			]);
		});

		it("emits STOP when desired stopped and actual is not", () => {
			const actions = lifecycleHandler.reconcile(
				[
					{
						workload_key: "wk-1",
						instrumentation_status: "discovered",
					},
				],
				new Map([
					[
						"wk-1",
						{
							workload_key: "wk-1",
							cluster_id: "default",
							feature: "lifecycle",
							desired_status: "stopped",
							config: "{}",
							updated_at: "t",
						},
					],
				])
			);

			expect(actions[0].actionType).toBe(KNOWN_ACTIONS.STOP_WORKLOAD);
		});

		it("skips services without desired state", () => {
			expect(
				lifecycleHandler.reconcile(
					[{ workload_key: "wk-x", instrumentation_status: "discovered" }],
					new Map()
				)
			).toEqual([]);
		});

		it("defaults missing desired config to {}", () => {
			const actions = lifecycleHandler.reconcile(
				[
					{
						workload_key: "wk-1",
						instrumentation_status: "discovered",
						resource_attributes: {
							"openlit.lifecycle.status": "stopped",
						},
					},
				],
				new Map([
					[
						"wk-1",
						{
							workload_key: "wk-1",
							cluster_id: "default",
							feature: "lifecycle",
							desired_status: "running",
							config: undefined as any,
							updated_at: "t",
						},
					],
				])
			);

			expect(actions[0].payload).toBe("{}");
		});
	});
});
