import {
	requireScannerAccess,
	withScannerAccess,
	withScannerAudit,
} from "@/lib/access/scanner-route";

describe("CE scanner route fallback", () => {
	it("keeps handlers unchanged", async () => {
		const handler = jest.fn().mockResolvedValue({ status: 204 });
		const wrapped = withScannerAudit(withScannerAccess("scan", handler));

		await wrapped({} as Request);

		expect(handler).toHaveBeenCalledTimes(1);
		expect(wrapped).toBe(handler);
	});

	it("allows library callers without enforcing RBAC", async () => {
		await expect(requireScannerAccess("read")).resolves.toBeUndefined();
	});
});
