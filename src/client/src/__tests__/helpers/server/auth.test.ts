jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));

import { getCurrentUser } from "@/lib/session";
import { resolveDbConfigId } from "@/helpers/server/auth";

describe("resolveDbConfigId", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("prefers the x-database-config-id header", async () => {
		const request = new Request("http://localhost", {
			headers: { "x-database-config-id": "db-header" },
		});
		await expect(resolveDbConfigId(request)).resolves.toEqual([null, "db-header"]);
		expect(getCurrentUser).not.toHaveBeenCalled();
	});

	it("returns unauthorized when there is no header and no user", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		await expect(resolveDbConfigId(new Request("http://localhost"))).resolves.toEqual([
			"Unauthorized",
			undefined,
		]);
	});

	it("returns null error with undefined id when user is present without header", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		await expect(resolveDbConfigId(new Request("http://localhost"))).resolves.toEqual([
			null,
			undefined,
		]);
	});
});
