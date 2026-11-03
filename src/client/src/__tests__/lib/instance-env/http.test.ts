/**
 * @jest-environment node
 */
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/instance-admin", () => ({ isInstanceAdminUser: jest.fn() }));

import { getCurrentUser } from "@/lib/session";
import { isInstanceAdminUser } from "@/lib/instance-admin";
import { GET, PATCH, VERIFY } from "@/lib/instance-env/http";

const request = {} as Request;

describe("instance auth route fallback", () => {
	beforeEach(() => jest.clearAllMocks());

	it("requires an enterprise plan for the instance admin", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "admin" });
		(isInstanceAdminUser as jest.Mock).mockResolvedValue(true);
		for (const handler of [GET, PATCH, VERIFY]) {
			const response = await handler(request, {});
			expect(response.status).toBe(403);
			await expect(response.json()).resolves.toMatchObject({
				featureId: "enterprise.instance-admin",
			});
		}
	});

	it("checks the instance admin before reporting the plan", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		expect((await GET(request, {})).status).toBe(401);

		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "member" });
		(isInstanceAdminUser as jest.Mock).mockResolvedValue(false);
		const denied = await PATCH(request, {});
		expect(denied.status).toBe(403);
		await expect(denied.json()).resolves.not.toHaveProperty("featureId");
	});
});
