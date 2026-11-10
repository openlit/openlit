jest.mock("@/lib/edition", () => ({
	getOpenLitEdition: jest.fn(() => "oss"),
}));

jest.mock("@/lib/platform/controller", () => ({
	getControllerInstances: jest.fn(),
	upsertControllerInstance: jest.fn(),
	upsertServices: jest.fn(),
	getControllerConfig: jest.fn(),
	getControllerInstanceById: jest.fn(),
	getPendingActions: jest.fn(),
	markActionsAcknowledged: jest.fn(),
	completeAction: jest.fn(),
	getConfigHash: jest.fn(),
	queueAction: jest.fn(),
	getActionsByIds: jest.fn(),
	getFeatureDesiredStates: jest.fn(),
	getEnvironmentFeatureConfigs: jest.fn(),
	updateFeatureDesiredState: jest.fn(),
}));

jest.mock("@/lib/platform/controller/features", () => ({
	getAllFeatureHandlers: jest.fn(() => []),
}));

jest.mock("@/lib/platform/api-keys", () => ({
	getAPIKeyInfo: jest.fn(),
}));

import { GET as getInstances } from "@/app/api/controller/instances/route";
import { POST as poll } from "@/app/api/controller/poll/route";
import { getControllerInstances } from "@/lib/platform/controller";
import { getAPIKeyInfo } from "@/lib/platform/api-keys";

describe("controller routes when edition is oss", () => {
	it("GET /api/controller/instances returns 404", async () => {
		const res = await getInstances();
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: "Not found" });
		expect(getControllerInstances).not.toHaveBeenCalled();
	});

	it("POST /api/controller/poll returns 404 before auth", async () => {
		const res = await poll({
			headers: {
				get: (name: string) =>
					name.toLowerCase() === "authorization"
						? "Bearer openlit-test"
						: null,
			},
		} as unknown as Request);
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: "Not found" });
		expect(getAPIKeyInfo).not.toHaveBeenCalled();
	});
});
