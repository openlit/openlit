import { getEnterpriseFeatureAccessSnapshot } from "@/lib/enterprise-feature-access";

describe("CE enterprise feature access fallback", () => {
	it("returns an empty access snapshot", async () => {
		await expect(getEnterpriseFeatureAccessSnapshot()).resolves.toEqual({
			accounts: [],
			selectedAccountId: "",
			accessByAccountId: {},
		});
	});
});
