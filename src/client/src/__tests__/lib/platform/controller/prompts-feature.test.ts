
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
import promptsHandler from "@/lib/platform/controller/features/prompts";
import { KNOWN_ACTIONS } from "@/types/controller";

const mockGetServiceById = getServiceById as jest.Mock;
const mockGetControllerIds = getControllerIdsForWorkload as jest.Mock;
const mockQueueAction = queueAction as jest.Mock;
const mockUpdateDesired = updateFeatureDesiredState as jest.Mock;

const baseService = {
	id: "svc-1",
	workload_key: "linux:prompt-app",
	cluster_id: "default",
	service_name: "prompt-app",
	namespace: "",
	controller_instance_id: "ctrl-1",
};

beforeEach(() => {
	jest.clearAllMocks();
	mockGetControllerIds.mockResolvedValue({ data: [] });
	mockQueueAction.mockResolvedValue({ data: "ok" });
	mockUpdateDesired.mockResolvedValue({ data: "ok" });
});

describe("prompts feature", () => {
	it("validates push/remove only", () => {
		expect(promptsHandler.validatePayload("push", {})).toBeNull();
		expect(promptsHandler.validatePayload("remove", {})).toBeNull();
		expect(promptsHandler.validatePayload("status", {})).toMatch(
			/Unknown operation/
		);
	});

	it("returns empty reconcile actions (stub)", () => {
		expect(promptsHandler.reconcile([], new Map())).toEqual([]);
	});

	it("returns 404 when service is missing", async () => {
		mockGetServiceById.mockResolvedValue({ data: [] });
		const res = await promptsHandler.applyOperation("svc-1", "push", {
			id: "p1",
		});
		expect(res.status).toBe(404);
	});

	it("returns 500 when workload_key is missing", async () => {
		mockGetServiceById.mockResolvedValue({
			data: [{ ...baseService, workload_key: null }],
		});
		const res = await promptsHandler.applyOperation("svc-1", "push", {});
		expect(res.status).toBe(500);
	});

	it("queues PUSH_PROMPTS", async () => {
		mockGetServiceById.mockResolvedValue({ data: [baseService] });
		mockGetControllerIds.mockResolvedValue({
			data: [
				{ controller_instance_id: "ctrl-a" },
				{ controller_instance_id: "ctrl-b" },
			],
		});

		const res = await promptsHandler.applyOperation(
			"svc-1",
			"push",
			{ prompt: "hi" },
			"db-1"
		);
		const body = await res.json();

		expect(body).toEqual({
			status: "queued",
			action: KNOWN_ACTIONS.PUSH_PROMPTS,
			controllers: 2,
		});
		expect(mockQueueAction).toHaveBeenCalledTimes(2);
		expect(mockUpdateDesired).toHaveBeenCalledWith(
			baseService.workload_key,
			"default",
			"prompts",
			"active",
			JSON.stringify({ prompt: "hi" }),
			"db-1"
		);
	});

	it("queues REMOVE_PROMPTS and falls back to service controller", async () => {
		mockGetServiceById.mockResolvedValue({
			data: [{ ...baseService, cluster_id: undefined }],
		});

		const res = await promptsHandler.applyOperation("svc-1", "remove", {});
		const body = await res.json();

		expect(body.action).toBe(KNOWN_ACTIONS.REMOVE_PROMPTS);
		expect(mockQueueAction).toHaveBeenCalledWith(
			"ctrl-1",
			KNOWN_ACTIONS.REMOVE_PROMPTS,
			baseService.workload_key,
			"{}",
			undefined
		);
	});

	it("returns 500 on unexpected errors", async () => {
		mockGetServiceById.mockRejectedValue(new Error("boom"));
		const res = await promptsHandler.applyOperation("svc-1", "push", {});
		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: "boom" });
	});

	it("uses fallback error message for non-Error throws", async () => {
		mockGetServiceById.mockRejectedValue("x");
		const res = await promptsHandler.applyOperation("svc-1", "push", {});
		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({
			error: "Prompts operation failed",
		});
	});
});
