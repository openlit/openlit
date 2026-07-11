import {
	shouldPreferRollup,
	queryHasScopeFilters,
} from "@/lib/platform/datasource/rollup-policy";

describe("rollup-policy", () => {
	it("prefers rollups for unscoped and service/env scoped reads", () => {
		expect(shouldPreferRollup({} as any)).toBe(true);
		expect(
			shouldPreferRollup({
				selectedConfig: { serviceNames: ["demo-openai-app"] },
			} as any)
		).toBe(true);
		expect(
			shouldPreferRollup({
				selectedConfig: { environments: ["prod"] },
			} as any)
		).toBe(true);
	});

	it("skips rollups when version-hash scope is present", () => {
		expect(
			shouldPreferRollup({
				selectedConfig: { versionFilter: { versionHash: "abc" } },
			} as any)
		).toBe(false);
	});

	it("detects scope filters on OpenLITQuery", () => {
		expect(
			queryHasScopeFilters({
				signal: "traces",
				timeRange: { start: new Date(), end: new Date() },
				filters: [
					{
						target: "attribute",
						scope: "resource",
						key: "service.name",
						op: "eq",
						value: "api",
					},
				],
			})
		).toBe(true);
		expect(
			queryHasScopeFilters({
				signal: "traces",
				timeRange: { start: new Date(), end: new Date() },
			})
		).toBe(false);
	});
});
