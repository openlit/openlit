import { assertPremiumConnectorAllowed } from "@/lib/access/connector-entitlement";

describe("CE connector entitlement fallback", () => {
	it("allows any connector type without checking entitlements", async () => {
		await expect(
			assertPremiumConnectorAllowed("datadog")
		).resolves.toBeUndefined();
		await expect(
			assertPremiumConnectorAllowed("tempo")
		).resolves.toBeUndefined();
	});
});
