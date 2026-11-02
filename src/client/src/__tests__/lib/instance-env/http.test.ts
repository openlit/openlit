import { GET, PATCH, VERIFY } from "@/lib/instance-env/http";

describe("instance environment route fallback", () => {
	it("requires an enterprise plan for reads, updates, and credential checks", async () => {
		for (const response of [GET(), PATCH(), VERIFY()]) {
			expect(response.status).toBe(403);
			await expect(response.json()).resolves.toMatchObject({
				featureId: "enterprise.instance-admin",
			});
		}
	});
});
