jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));

import { getCurrentUser } from "@/lib/session";
import { resolveDbConfigId } from "@/helpers/server/auth";

function makeRequest(headers: Record<string, string> = {}) {
	return {
		headers: {
			get: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? null,
		},
	} as unknown as Request;
}

describe("resolveDbConfigId", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("prefers the x-database-config-id header", async () => {
		await expect(
			resolveDbConfigId(makeRequest({ "x-database-config-id": "db-header" }))
		).resolves.toEqual([null, "db-header"]);
		expect(getCurrentUser).not.toHaveBeenCalled();
	});

	it("returns unauthorized when there is no header and no user", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		await expect(resolveDbConfigId(makeRequest())).resolves.toEqual([
			"Unauthorized",
			undefined,
		]);
	});

	it("returns null error with undefined id when user is present without header", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		await expect(resolveDbConfigId(makeRequest())).resolves.toEqual([
			null,
			undefined,
		]);
	});
});
