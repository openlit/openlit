import {
	getFilterStorageKey,
	stripFilterParams,
} from "@/helpers/client/filter-persistence";

describe("filter persistence helpers", () => {
	it("scopes filter storage keys by observability type/page", () => {
		expect(getFilterStorageKey("request")).toBe("openlit_filter_v1:request");
		expect(getFilterStorageKey("metrics")).toBe("openlit_filter_v1:metrics");
		expect(getFilterStorageKey("logs")).toBe("openlit_filter_v1:logs");
		expect(getFilterStorageKey("request")).not.toBe(
			getFilterStorageKey("logs")
		);
	});

	it("keeps the legacy global key when no scope is provided", () => {
		expect(getFilterStorageKey()).toBe("openlit_filter_v1");
	});

	it("strips filter params while preserving non-filter observability params", () => {
		const params = new URLSearchParams({
			tab: "traces",
			selected: "span-1",
			models: "gpt-4o-mini",
			services: "api",
			tr: "7D",
			gb: "serviceName",
			limit: "50",
		});

		stripFilterParams(params);

		expect(params.get("tab")).toBe("traces");
		expect(params.get("selected")).toBe("span-1");
		expect(params.has("models")).toBe(false);
		expect(params.has("services")).toBe(false);
		expect(params.has("tr")).toBe(false);
		expect(params.has("gb")).toBe(false);
		expect(params.has("limit")).toBe(false);
	});
});
