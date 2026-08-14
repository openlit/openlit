import { recordOrganisationUsageEvent } from "@/lib/billing/usage-recorder";

describe("CE usage recorder fallback", () => {
	it("does not record usage events in CE", async () => {
		await expect(
			recordOrganisationUsageEvent({
				organisationId: "org-1",
				projectId: "project-1",
				featureId: "otter",
				quantity: 2,
				periodStart: new Date("2026-01-01T00:00:00Z"),
				periodEnd: new Date("2026-02-01T00:00:00Z"),
			})
		).resolves.toBeNull();
	});
});
