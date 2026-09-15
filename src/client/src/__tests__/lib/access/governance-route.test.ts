import {
	withGovernanceAccess,
	withGovernanceAudit,
} from "@/lib/access/governance-route";

describe("CE governance route fallback", () => {
	it("keeps handlers unchanged", async () => {
		const handler = jest.fn().mockResolvedValue({ status: 200 });
		const wrapped = withGovernanceAudit(withGovernanceAccess("read", handler));

		await wrapped({} as Request);

		expect(handler).toHaveBeenCalledTimes(1);
		expect(wrapped).toBe(handler);
	});
});
