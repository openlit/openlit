jest.mock("@/utils/validation", () => ({
	sanitizeErrorMessage: jest.fn((err: unknown, fallback: string) =>
		err instanceof Error ? fallback : String(err || fallback)
	),
}));

import { errorResponse } from "@/utils/api-response";
import { sanitizeErrorMessage } from "@/utils/validation";

class TestResponse {
	status: number;
	private body: unknown;

	constructor(body: unknown, init?: { status?: number }) {
		this.body = body;
		this.status = init?.status || 200;
	}

	static json(body: unknown, init?: { status?: number }) {
		return new TestResponse(body, init);
	}

	async json() {
		return this.body;
	}
}

describe("errorResponse", () => {
	beforeAll(() => {
		(global as any).Response = TestResponse;
	});

	it("returns a sanitized JSON error response with the provided status", async () => {
		const response = errorResponse(new Error("db trace"), "Safe error", 503);

		expect(sanitizeErrorMessage).toHaveBeenCalledWith(
			expect.any(Error),
			"Safe error"
		);
		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toBe("Safe error");
	});

	it("uses default fallback and status", async () => {
		const response = errorResponse(undefined);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe("An unexpected error occurred");
	});
});
