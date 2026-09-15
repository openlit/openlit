
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
	getControllerIdsForWorkload,
	queueAction,
	updateFeatureDesiredState,
} from "@/lib/platform/controller";
import envsHandler from "@/lib/platform/controller/features/envs";
import { KNOWN_ACTIONS } from "@/types/controller";

const mockGetServiceById = getServiceById as jest.Mock;
const mockGetControllerIds = getControllerIdsForWorkload as jest.Mock;
const mockQueueAction = queueAction as jest.Mock;
const mockUpdateDesired = updateFeatureDesiredState as jest.Mock;

const baseService = {
	id: "svc-1",
	workload_key: "k8s:default:deployment/app",
	cluster_id: "cluster-a",
	service_name: "app",
	namespace: "default",
	controller_instance_id: "ctrl-1",
};

beforeEach(() => {
	jest.clearAllMocks();
	mockGetControllerIds.mockResolvedValue({ data: [] });
	mockQueueAction.mockResolvedValue({ data: "ok" });
	mockUpdateDesired.mockResolvedValue({ data: "ok" });
});

describe("envs feature", () => {
	it("validates push/remove only", () => {
		expect(envsHandler.validatePayload("push", {})).toBeNull();
		expect(envsHandler.validatePayload("remove", {})).toBeNull();
		expect(envsHandler.validatePayload("enable", {})).toMatch(/Unknown operation/);
	});

	it("returns empty reconcile actions (stub)", () => {
		expect(envsHandler.reconcile([], new Map())).toEqual([]);
	});

	it("returns 404 when service is missing", async () => {
		mockGetServiceById.mockResolvedValue({ data: [] });
		const res = await envsHandler.applyOperation("svc-1", "push", { A: "1" });
		expect(res.status).toBe(404);
	});

	it("returns 500 when workload_key is missing", async () => {
		mockGetServiceById.mockResolvedValue({
			data: [{ ...baseService, workload_key: "" }],
		});
		const res = await envsHandler.applyOperation("svc-1", "push", { A: "1" });
		expect(res.status).toBe(500);
	});

	it("queues PUSH_ENVS and updates desired state", async () => {
		mockGetServiceById.mockResolvedValue({ data: [baseService] });
		mockGetControllerIds.mockResolvedValue({
			data: [{ controller_instance_id: "ctrl-2" }],
		});

		const res = await envsHandler.applyOperation(
			"svc-1",
			"push",
			{ FOO: "bar" },
			"db-1"
		);
		const body = await res.json();

		expect(body).toMatchObject({
			status: "queued",
			action: KNOWN_ACTIONS.PUSH_ENVS,
			controllers: 1,
		});
		expect(mockUpdateDesired).toHaveBeenCalledWith(
			baseService.workload_key,
			"cluster-a",
			"envs",
			"active",
			JSON.stringify({ FOO: "bar" }),
			"db-1"
		);
		expect(mockQueueAction).toHaveBeenCalledWith(
			"ctrl-2",
			KNOWN_ACTIONS.PUSH_ENVS,
			baseService.workload_key,
			JSON.stringify({ FOO: "bar" }),
			"db-1"
		);
	});

	it("falls back to service controller when no workload controllers found", async () => {
		mockGetServiceById.mockResolvedValue({
			data: [{ ...baseService, cluster_id: undefined, namespace: undefined }],
		});

		const res = await envsHandler.applyOperation("svc-1", "remove", {});
		const body = await res.json();

		expect(body.action).toBe(KNOWN_ACTIONS.REMOVE_ENVS);
		expect(mockUpdateDesired).toHaveBeenCalledWith(
			baseService.workload_key,
			"default",
			"envs",
			"none",
			"{}",
			undefined
		);
		expect(mockQueueAction).toHaveBeenCalledWith(
			"ctrl-1",
			KNOWN_ACTIONS.REMOVE_ENVS,
			baseService.workload_key,
			"{}",
			undefined
		);
	});

	it("returns 500 when an unexpected error is thrown", async () => {
		mockGetServiceById.mockRejectedValue(new Error("db boom"));
		const res = await envsHandler.applyOperation("svc-1", "push", {});
		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: "db boom" });
	});

	it("uses fallback error message for non-Error throws", async () => {
		mockGetServiceById.mockRejectedValue({});
		const res = await envsHandler.applyOperation("svc-1", "push", {});
		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({
			error: "ENVs operation failed",
		});
	});
});
