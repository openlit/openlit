
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
import instrumentationHandler from "@/lib/platform/controller/features/instrumentation";
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
	instrumentation_status: "discovered",
};

beforeEach(() => {
	jest.clearAllMocks();
	mockGetControllerIds.mockResolvedValue({ data: [] });
	mockQueueAction.mockResolvedValue({ data: "ok" });
	mockUpdateDesired.mockResolvedValue({ data: "ok" });
});

describe("instrumentation feature", () => {
	it("validates enable/disable only", () => {
		expect(instrumentationHandler.validatePayload("enable", {})).toBeNull();
		expect(instrumentationHandler.validatePayload("disable", {})).toBeNull();
		expect(instrumentationHandler.validatePayload("push", {})).toMatch(
			/Unknown operation/
		);
	});

	it("returns 404 when service is missing", async () => {
		mockGetServiceById.mockResolvedValue({ data: [] });
		const res = await instrumentationHandler.applyOperation(
			"svc-1",
			"enable",
			{}
		);
		expect(res.status).toBe(404);
	});

	it("returns 500 when workload_key is missing", async () => {
		mockGetServiceById.mockResolvedValue({
			data: [{ ...baseService, workload_key: undefined }],
		});
		const res = await instrumentationHandler.applyOperation(
			"svc-1",
			"enable",
			{}
		);
		expect(res.status).toBe(500);
	});

	it("queues INSTRUMENT on enable", async () => {
		mockGetServiceById.mockResolvedValue({ data: [baseService] });
		mockGetControllerIds.mockResolvedValue({
			data: [{ controller_instance_id: "ctrl-2" }],
		});

		const res = await instrumentationHandler.applyOperation(
			"svc-1",
			"enable",
			{},
			"db-1"
		);
		const body = await res.json();

		expect(body).toEqual({
			status: "queued",
			action: KNOWN_ACTIONS.INSTRUMENT,
			controllers: 1,
		});
		expect(mockUpdateDesired).toHaveBeenCalledWith(
			baseService.workload_key,
			"cluster-a",
			"instrumentation",
			"instrumented",
			"{}",
			"db-1"
		);
		expect(mockQueueAction).toHaveBeenCalledWith(
			"ctrl-2",
			KNOWN_ACTIONS.INSTRUMENT,
			baseService.workload_key,
			"{}",
			"db-1"
		);
	});

	it("queues UNINSTRUMENT and falls back to service controller", async () => {
		mockGetServiceById.mockResolvedValue({
			data: [{ ...baseService, cluster_id: undefined, namespace: undefined }],
		});

		const res = await instrumentationHandler.applyOperation(
			"svc-1",
			"disable",
			{}
		);
		const body = await res.json();

		expect(body.action).toBe(KNOWN_ACTIONS.UNINSTRUMENT);
		expect(mockUpdateDesired).toHaveBeenCalledWith(
			baseService.workload_key,
			"default",
			"instrumentation",
			"none",
			"{}",
			undefined
		);
		expect(mockQueueAction).toHaveBeenCalledWith(
			"ctrl-1",
			KNOWN_ACTIONS.UNINSTRUMENT,
			baseService.workload_key,
			"{}",
			undefined
		);
	});

	it("returns 500 on unexpected errors", async () => {
		mockGetServiceById.mockRejectedValue(new Error("boom"));
		const res = await instrumentationHandler.applyOperation(
			"svc-1",
			"enable",
			{}
		);
		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({ error: "boom" });
	});

	it("uses fallback error message for non-Error throws", async () => {
		mockGetServiceById.mockRejectedValue({});
		const res = await instrumentationHandler.applyOperation(
			"svc-1",
			"enable",
			{}
		);
		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({
			error: "Instrumentation operation failed",
		});
	});

	describe("reconcile", () => {
		it("emits INSTRUMENT when desired instrumented and actual is not", () => {
			const actions = instrumentationHandler.reconcile(
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
							feature: "instrumentation",
							desired_status: "instrumented",
							config: '{"x":1}',
							updated_at: "t",
						},
					],
				])
			);

			expect(actions).toEqual([
				{
					actionType: KNOWN_ACTIONS.INSTRUMENT,
					serviceKey: "wk-1",
					payload: '{"x":1}',
				},
			]);
		});

		it("emits UNINSTRUMENT when desired none and actual instrumented", () => {
			const actions = instrumentationHandler.reconcile(
				[
					{
						workload_key: "wk-1",
						instrumentation_status: "instrumented",
					},
				],
				new Map([
					[
						"wk-1",
						{
							workload_key: "wk-1",
							cluster_id: "default",
							feature: "instrumentation",
							desired_status: "none",
							config: "{}",
							updated_at: "t",
						},
					],
				])
			);

			expect(actions[0].actionType).toBe(KNOWN_ACTIONS.UNINSTRUMENT);
		});

		it("skips services without desired state and matching statuses", () => {
			const actions = instrumentationHandler.reconcile(
				[
					{ workload_key: "wk-skip", instrumentation_status: "discovered" },
					{
						workload_key: "wk-ok",
						instrumentation_status: "instrumented",
					},
				],
				new Map([
					[
						"wk-ok",
						{
							workload_key: "wk-ok",
							cluster_id: "default",
							feature: "instrumentation",
							desired_status: "instrumented",
							config: "{}",
							updated_at: "t",
						},
					],
				])
			);

			expect(actions).toEqual([]);
		});

		it("defaults payload to {} when desired config is missing", () => {
			const actions = instrumentationHandler.reconcile(
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
							feature: "instrumentation",
							desired_status: "instrumented",
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
