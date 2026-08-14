import {
	FEATURES,
	getFeatureDefinition,
	getPaidFeatures,
} from "@/features";
import {
	disabledFeature,
	upgradeRequiredBody,
	upgradeRequiredResponse,
} from "@/features/disabled-feature";
import { onOrganisationChanged } from "@/features/organisation";
import { canManageOrganisation } from "@/features/organisation-access";
import { FEATURES as REGISTRY_FEATURES } from "@/features/registry";
import { getEnterpriseSidebarItems } from "@/features/sidebar";

beforeAll(() => {
	Object.defineProperty(global, "Response", {
		value: {
			json: (body: unknown, init?: ResponseInit) => ({
				status: init?.status ?? 200,
				json: jest.fn().mockResolvedValue(body),
			}),
		},
		configurable: true,
	});
});

describe("CE feature fallbacks", () => {
	it("exposes an empty edition feature registry in CE", () => {
		expect(FEATURES).toEqual({});
		expect(REGISTRY_FEATURES).toBe(FEATURES);
		expect(getPaidFeatures()).toEqual([]);
	});

	it("creates a safe enterprise fallback for unknown feature definitions", () => {
		expect(getFeatureDefinition("audit-logs")).toEqual({
			id: "audit-logs",
			name: "audit-logs",
			tier: "enterprise",
			description: "Paid feature.",
		});
	});

	it("builds upgrade-required payloads and responses", async () => {
		const body = upgradeRequiredBody("audit-logs");

		expect(body).toEqual({
			code: "upgrade_required",
			featureId: "audit-logs",
			featureName: "audit-logs",
			message: "audit-logs requires an active Enterprise plan.",
		});

		const response = upgradeRequiredResponse("audit-logs");
		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual(body);
	});

	it("returns disabled feature handles with upgrade responses", async () => {
		const feature = disabledFeature("seats");

		expect(feature.featureId).toBe("seats");
		expect(feature.isEnabled).toBe(false);

		const response = feature.upgradeRequired();
		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			code: "upgrade_required",
			featureId: "seats",
		});
	});

	it("keeps enterprise sidebar and organisation hooks as CE no-ops", async () => {
		expect(getEnterpriseSidebarItems("monitoring", "icon")).toEqual([]);
		expect(getEnterpriseSidebarItems("configuration", "icon")).toEqual([]);
		await expect(onOrganisationChanged("org-1")).resolves.toBeUndefined();
		await expect(
			canManageOrganisation({
				organisationId: "org-1",
				userId: "user-1",
				action: "organisation.update",
			})
		).resolves.toBeUndefined();
	});
});
