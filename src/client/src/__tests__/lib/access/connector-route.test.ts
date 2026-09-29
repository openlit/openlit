import { withConnectorAccess, withConnectorAudit } from "@/lib/access/connector-route";

describe("CE connector route fallback", () => {
	it("withConnectorAccess returns the handler unchanged regardless of action", () => {
		const handler = jest.fn().mockResolvedValue({ status: 204 });

		const wrapped = withConnectorAccess("read", handler);

		expect(wrapped).toBe(handler);
	});

	it("withConnectorAccess is a pass-through identity wrapper for any action", () => {
		const handler = { name: "sample-handler" };

		expect(withConnectorAccess("create", handler)).toBe(handler);
		expect(withConnectorAccess("update", handler)).toBe(handler);
		expect(withConnectorAccess("delete", handler)).toBe(handler);
		expect(withConnectorAccess("test", handler)).toBe(handler);
		expect(withConnectorAccess("bind", handler)).toBe(handler);
	});

	it("withConnectorAudit returns the handler unchanged", () => {
		const handler = jest.fn();

		const wrapped = withConnectorAudit(handler);

		expect(wrapped).toBe(handler);
	});

	it("wrapped handlers behave exactly like the original", async () => {
		const handler = jest.fn().mockResolvedValue("ok");

		const accessWrapped = withConnectorAccess("read", handler);
		const auditWrapped = withConnectorAudit(handler);

		await expect(accessWrapped()).resolves.toBe("ok");
		await expect(auditWrapped()).resolves.toBe("ok");
		expect(handler).toHaveBeenCalledTimes(2);
	});
});
