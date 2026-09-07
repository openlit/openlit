import {
	shouldPreferRollup,
	queryHasScopeFilters,
} from "@/lib/platform/connectors/datasource/rollup-policy";

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

	it("detects deployment.environment as a scope filter", () => {
		expect(
			queryHasScopeFilters({
				signal: "traces",
				timeRange: { start: new Date(), end: new Date() },
				filters: [
					{
						target: "attribute",
						scope: "resource",
						key: "deployment.environment",
						op: "eq",
						value: "prod",
					},
				],
			})
		).toBe(true);
	});

	it("detects openlit.agent.version_hash as a scope filter", () => {
		expect(
			queryHasScopeFilters({
				signal: "traces",
				timeRange: { start: new Date(), end: new Date() },
				filters: [
					{
						target: "attribute",
						scope: "span",
						key: "openlit.agent.version_hash",
						op: "eq",
						value: "abc123",
					},
				],
			})
		).toBe(true);
	});

	it("ignores non-attribute targets and filters without a key", () => {
		expect(
			queryHasScopeFilters({
				signal: "traces",
				timeRange: { start: new Date(), end: new Date() },
				filters: [
					{
						target: "duration",
						scope: "resource",
						key: "service.name",
						op: "eq",
						value: "api",
					},
				],
			})
		).toBe(false);
		expect(
			queryHasScopeFilters({
				signal: "traces",
				timeRange: { start: new Date(), end: new Date() },
				filters: [
					{
						target: "attribute",
						scope: "resource",
						key: "",
						op: "eq",
						value: "api",
					},
				],
			})
		).toBe(false);
	});

	it("ignores unrelated attribute keys", () => {
		expect(
			queryHasScopeFilters({
				signal: "traces",
				timeRange: { start: new Date(), end: new Date() },
				filters: [
					{
						target: "attribute",
						scope: "span",
						key: "http.status_code",
						op: "eq",
						value: "200",
					},
				],
			})
		).toBe(false);
	});
});
