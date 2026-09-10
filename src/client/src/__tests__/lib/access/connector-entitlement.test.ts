import {
	assertPremiumConnectorAllowed,
	getConnectorCatalogLocks,
} from "@/lib/access/connector-entitlement";

describe("CE connector entitlement fallback", () => {
	it("allows any connector type without checking entitlements", async () => {
		await expect(
			assertPremiumConnectorAllowed("datadog")
		).resolves.toBeUndefined();
		await expect(
			assertPremiumConnectorAllowed("tempo")
		).resolves.toBeUndefined();
	});

	it("returns an unlocked catalog with no premium types", async () => {
		await expect(getConnectorCatalogLocks()).resolves.toEqual({
			entitled: true,
			premiumTypes: new Set(),
		});
	});
});
