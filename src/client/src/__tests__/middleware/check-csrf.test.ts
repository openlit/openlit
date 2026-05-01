import { NextResponse } from "next/server";

jest.mock("next/server", () => ({
	NextResponse: {
		json: jest.fn((body, init) => ({ body, init })),
	},
}));

import checkCsrf from "@/middleware/check-csrf";

const makeRequest = (
	method: string,
	pathname: string,
	headers: Record<string, string | undefined> = {}
) => ({
	method,
	nextUrl: { pathname },
	headers: {
		get: (key: string) => headers[key.toLowerCase()],
	},
});

const makeFetchEvent = () => ({} as any);

describe("checkCsrf", () => {
	const nextHandler = jest.fn();
	let middleware: ReturnType<typeof checkCsrf>;

	beforeEach(() => {
		jest.clearAllMocks();
		middleware = checkCsrf(nextHandler);
	});

	it("blocks state-changing API requests from a different origin", async () => {
		const req = makeRequest("POST", "/api/db-config", {
			origin: "https://evil.example.com",
			host: "app.example.com",
		});

		const result = await middleware(req as any, makeFetchEvent());

		expect(NextResponse.json).toHaveBeenCalledWith("Forbidden", {
			status: 403,
		});
		expect(result).toEqual({ body: "Forbidden", init: { status: 403 } });
		expect(nextHandler).not.toHaveBeenCalled();
	});

	it("allows state-changing API requests from the same origin", async () => {
		const req = makeRequest("DELETE", "/api/api-key/key-1", {
			origin: "https://app.example.com",
			host: "app.example.com",
		});

		await middleware(req as any, makeFetchEvent());

		expect(nextHandler).toHaveBeenCalledWith(req, expect.anything());
	});

	it("skips token-auth API routes", async () => {
		const req = makeRequest("POST", "/api/rule-engine/evaluate", {
			origin: "https://evil.example.com",
			host: "app.example.com",
		});

		await middleware(req as any, makeFetchEvent());

		expect(nextHandler).toHaveBeenCalledWith(req, expect.anything());
	});
});
