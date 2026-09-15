import {
	recordMemoryMutationAudit,
	requireMemoryAccess,
	withMemoryAccess,
	withMemoryAudit,
} from "@/lib/access/memory-route";

describe("CE memory route fallback", () => {
	it("keeps handlers unchanged", async () => {
		const handler = jest.fn().mockResolvedValue({ status: 204 });
		const wrapped = withMemoryAudit(withMemoryAccess("create", handler));

		await wrapped({} as Request);

		expect(handler).toHaveBeenCalledTimes(1);
		expect(wrapped).toBe(handler);
	});

	it("allows library callers without enforcing RBAC or audit", async () => {
		await expect(requireMemoryAccess("delete")).resolves.toBeUndefined();
		await expect(
			recordMemoryMutationAudit({
				action: "create",
				targetId: "m1",
				contentLength: 12,
			})
		).resolves.toBeUndefined();
	});
});
