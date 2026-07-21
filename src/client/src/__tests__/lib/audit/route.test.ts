import { withAudit } from "@/lib/audit/route";

describe("CE audit route fallback", () => {
	it("withAudit returns the handler unchanged", async () => {
		const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }));
		const wrapped = withAudit(handler);

		expect(wrapped).toBe(handler);
		await wrapped({} as Request, {});
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
