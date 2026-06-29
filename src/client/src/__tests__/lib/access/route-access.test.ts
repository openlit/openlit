import { requireRouteAccess, withRouteAccess } from "@/lib/access/route-access";

describe("CE route access fallback", () => {
	it("keeps handlers unchanged and has no enterprise access decision", async () => {
		const handler = jest.fn().mockResolvedValue({ status: 204 });
		const wrapped = withRouteAccess("prompt.create", handler);

		await wrapped({} as Request, {});

		expect(handler).toHaveBeenCalledTimes(1);
		await expect(requireRouteAccess("prompt.create")).resolves.toBeNull();
	});
});
