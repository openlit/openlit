import {
	withOtterChatAccess,
	withOtterConfigureAccess,
	withOtterDbChatAccess,
	withOtterDbReadAccess,
	withOtterReadAccess,
} from "@/lib/chat/access";

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

describe("Otter route access wrappers", () => {
	const wrappers = [
		withOtterReadAccess,
		withOtterChatAccess,
		withOtterConfigureAccess,
		withOtterDbReadAccess,
		withOtterDbChatAccess,
	];

	it("preserves handlers as OSS-safe passthroughs", async () => {
		for (const wrapper of wrappers) {
			const response = Response.json({ ok: true });
			const handler = jest.fn(() => response);

			const wrapped = wrapper(handler);

			expect(wrapped).toBe(handler);
			expect(await (wrapped as any)({ method: "GET" }, { params: {} })).toBe(response);
			expect(handler).toHaveBeenCalledWith(
				{ method: "GET" },
				{ params: {} }
			);
		}
	});
});
