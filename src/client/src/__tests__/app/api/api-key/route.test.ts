jest.mock("@/lib/platform/api-keys/index", () => ({
	generateAPIKey: jest.fn(),
	getAllAPIKeys: jest.fn(),
	deleteAPIKey: jest.fn(),
}));

import { POST } from "@/app/api/api-key/route";
import { PATCH } from "@/app/api/api-key/[id]/route";
import { generateAPIKey } from "@/lib/platform/api-keys/index";

function jsonRequest(body: unknown) {
	const raw = typeof body === "string" ? body : JSON.stringify(body);
	return { json: async () => JSON.parse(raw) } as unknown as Request;
}

describe("API key routes (community edition)", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(generateAPIKey as jest.Mock).mockResolvedValue({ id: "key-1" });
	});

	it("rejects invalid JSON on create", async () => {
		const res = await POST(jsonRequest("{not json"));
		expect(res.status).toBe(400);
		expect(generateAPIKey).not.toHaveBeenCalled();
	});

	it("creates a full-access key and ignores requested scopes", async () => {
		const res = await POST(jsonRequest({ name: "sdk", scopes: ["prompts"] }));
		expect(res.status).toBe(200);
		expect(generateAPIKey).toHaveBeenCalledWith("sdk", {});
	});

	it("does not support editing key access", async () => {
		const res = await PATCH(jsonRequest({ scopes: ["prompts"] }), {
			params: { id: "key-1" },
		});
		expect(res.status).toBe(403);
	});

	it("rejects invalid JSON on access update", async () => {
		const res = await PATCH(jsonRequest("{not json"), { params: { id: "key-1" } });
		expect(res.status).toBe(400);
	});
});
