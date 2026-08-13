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

import {
	requireCurrentOrganisationPermission,
	requireCurrentOrganisationEntitledPermission,
	withCurrentOrganisationPermission,
} from "@/lib/rbac/current";

describe("CE rbac current organisation fallbacks", () => {
	it("requireCurrentOrganisationPermission resolves to null", async () => {
		await expect(
			requireCurrentOrganisationPermission("dashboard.read")
		).resolves.toBeNull();
	});

	it("requireCurrentOrganisationEntitledPermission resolves to null", async () => {
		await expect(
			requireCurrentOrganisationEntitledPermission(
				"feature.alerts",
				"alerts.read"
			)
		).resolves.toBeNull();
	});

	it("withCurrentOrganisationPermission returns the handler unchanged", async () => {
		const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }));
		const wrapped = withCurrentOrganisationPermission(
			"dashboard.read",
			handler
		);

		expect(wrapped).toBe(handler);
		await wrapped({} as Request, {});
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
