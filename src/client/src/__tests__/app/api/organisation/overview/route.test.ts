import { POST as overviewPost } from "@/app/api/organisation/[id]/overview/route";
import { POST as filtersPost } from "@/app/api/organisation/[id]/overview/filters/route";
import { POST as spendLimitsPost } from "@/app/api/organisation/[id]/spend-limits/route";

describe("CE organisation overview routes", () => {
	it("returns upgrade required and does not read a database", async () => {
		const response = overviewPost();
		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			code: "upgrade_required",
			featureId: "enterprise.organisation-overview",
		});
	});

	it("locks the filters and spend-limit routes the same way", async () => {
		const filters = filtersPost();
		const limits = spendLimitsPost();
		expect(filters.status).toBe(403);
		expect(limits.status).toBe(403);
		await expect(filters.json()).resolves.toMatchObject({
			code: "upgrade_required",
		});
		await expect(limits.json()).resolves.toMatchObject({
			code: "upgrade_required",
		});
	});
});
