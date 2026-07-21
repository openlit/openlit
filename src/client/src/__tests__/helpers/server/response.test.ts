import { errorResponse, getErrorMessage } from "@/helpers/server/response";

describe("server response helpers", () => {
	it("extracts messages from Error, string, and message-bearing objects", () => {
		expect(getErrorMessage(new Error("boom"))).toBe("boom");
		expect(getErrorMessage("plain")).toBe("plain");
		expect(getErrorMessage({ message: "obj" })).toBe("obj");
		expect(getErrorMessage(null)).toBe("Request failed");
		expect(getErrorMessage(42, "fallback")).toBe("fallback");
	});

	it("builds JSON error responses with status and extras", async () => {
		const response = errorResponse(new Error("nope"), 403, { code: "denied" });
		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: "nope",
			err: "nope",
			code: "denied",
		});
	});
});
