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
	getAllFeatureHandlers,
	getFeatureHandler,
	registerFeature,
} from "@/lib/platform/controller/features";

describe("controller features index", () => {
	it("re-exports registry helpers and side-loads feature modules", () => {
		expect(typeof registerFeature).toBe("function");
		expect(typeof getFeatureHandler).toBe("function");
		expect(typeof getAllFeatureHandlers).toBe("function");

		const handlers = getAllFeatureHandlers();
		expect(handlers.length).toBeGreaterThan(0);
		expect(getFeatureHandler(handlers[0].feature)).toBe(handlers[0]);
	});
});
