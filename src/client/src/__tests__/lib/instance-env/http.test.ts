import { GET, PATCH } from "@/lib/instance-env/http";

describe("instance environment route fallback", () => {
	it("requires an enterprise plan for reads and updates", async () => {
		for (const response of [GET(), PATCH()]) {
			expect(response.status).toBe(403);
			await expect(response.json()).resolves.toMatchObject({
				featureId: "enterprise.instance-env",
			});
		}
	});
});
