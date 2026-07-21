jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));

import { getCurrentUser } from "@/lib/session";
import { resolveDbConfigId } from "@/helpers/server/auth";

describe("resolveDbConfigId", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns the header value when x-database-config-id is present", async () => {
		const request = new Request("http://localhost/api", {
			headers: { "x-database-config-id": "db-123" },
		});

		await expect(resolveDbConfigId(request)).resolves.toEqual([null, "db-123"]);
		expect(getCurrentUser).not.toHaveBeenCalled();
	});

	it("returns Unauthorized when header is missing and user is absent", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const request = new Request("http://localhost/api");

		await expect(resolveDbConfigId(request)).resolves.toEqual([
			"Unauthorized",
			undefined,
		]);
	});

	it("returns null error and undefined id when user is authenticated without header", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		const request = new Request("http://localhost/api");

		await expect(resolveDbConfigId(request)).resolves.toEqual([null, undefined]);
	});
});
