const mockWithDbConfigAccess = jest.fn((handler: any) => handler);

jest.mock("@/lib/rbac/route", () => ({
	withDbConfigAccess: (...args: Parameters<typeof mockWithDbConfigAccess>) =>
		mockWithDbConfigAccess(...args),
}));

import { requireRouteAccess, withRouteAccess } from "@/lib/access/route-access";

describe("CE route access fallback", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("keeps handlers unchanged and has no enterprise access decision", async () => {
		const handler = jest.fn().mockResolvedValue({ status: 204 });
		const wrapped = withRouteAccess("prompt.create", handler);

		await wrapped({} as Request, {});

		expect(handler).toHaveBeenCalledTimes(1);
		expect(mockWithDbConfigAccess).not.toHaveBeenCalled();
		await expect(requireRouteAccess("prompt.create")).resolves.toBeNull();
	});

	it("wraps handlers with DB config access when requested", () => {
		const handler = jest.fn();

		withRouteAccess("vault.read", handler, { requireDbConfig: true });

		expect(mockWithDbConfigAccess).toHaveBeenCalledWith(handler);
	});
});
