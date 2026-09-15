import { alertingUnavailable } from "@/lib/rbac/routes/api/alerts/unavailable";
import { fleetHubUnavailable } from "@/lib/rbac/routes/api/fleet-hub/unavailable";

beforeAll(() => {
	Object.defineProperty(global, "Response", {
		value: {
			json: (body: unknown, init?: ResponseInit) => ({
				status: init?.status ?? 200,
				json: jest.fn().mockResolvedValue(body),
			}),
		},
		configurable: true,
	});
});

describe("alertingUnavailable", () => {
	it("returns a 402 upgrade-required response with a CE-safe error message", () => {
		const response: any = alertingUnavailable();

		expect(response.status).toBe(402);
		expect(response.json()).resolves.toEqual({
			error: "Alerting is not available in this edition.",
		});
	});
});

describe("fleetHubUnavailable", () => {
	it("returns a 402 upgrade-required response with a CE-safe error message", () => {
		const response: any = fleetHubUnavailable();

		expect(response.status).toBe(402);
		expect(response.json()).resolves.toEqual({
			error: "Fleet Hub is not available in this edition.",
		});
	});
});
