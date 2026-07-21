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
