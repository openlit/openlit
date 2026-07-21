import { errorResponse, getErrorMessage } from "@/helpers/server/response";

describe("getErrorMessage", () => {
	it("returns Error.message", () => {
		expect(getErrorMessage(new Error("boom"))).toBe("boom");
	});

	it("returns string errors as-is", () => {
		expect(getErrorMessage("plain")).toBe("plain");
	});

	it("reads message from plain objects", () => {
		expect(getErrorMessage({ message: "obj" })).toBe("obj");
	});

	it("falls back for unknown values", () => {
		expect(getErrorMessage(42)).toBe("Request failed");
		expect(getErrorMessage(null, "custom")).toBe("custom");
		expect(getErrorMessage({ message: 1 })).toBe("Request failed");
	});
});

describe("errorResponse", () => {
	it("returns a JSON Response with status and extras", async () => {
		const res = errorResponse(new Error("nope"), 422, { code: "X" });
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toEqual({
			error: "nope",
			err: "nope",
			code: "X",
		});
	});

	it("defaults to status 400", async () => {
		const res = errorResponse("bad");
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toMatchObject({ error: "bad", err: "bad" });
	});
});
