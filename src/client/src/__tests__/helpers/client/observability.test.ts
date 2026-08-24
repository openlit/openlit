import { prepareObservabilitySignalChange } from "@/helpers/client/observability";
import { DEFAULT_SORTING, filterStoreSlice } from "@/store/filter";
import { withLenses } from "@dhmk/zustand-lens";
import { create } from "zustand";

const createStore = () => create<any>()(withLenses({ filter: filterStoreSlice }));

describe("prepareObservabilitySignalChange", () => {
	it("clears grouping, sorting, offset, and selected filters", () => {
		const updateConfig = jest.fn();
		const updateFilter = jest.fn();
		const updateAttributeKeys = jest.fn();

		prepareObservabilitySignalChange(
			updateConfig,
			updateFilter,
			updateAttributeKeys
		);

		expect(updateConfig).toHaveBeenCalledWith(undefined);
		expect(updateFilter).toHaveBeenCalledWith("groupBy", null);
		expect(updateFilter).toHaveBeenCalledWith(
			"selectedConfig",
			{},
			{ clearFilter: true }
		);
		expect(updateAttributeKeys).toHaveBeenCalledWith({
			spanAttributeKeys: [],
			resourceAttributeKeys: [],
			logAttributeKeys: [],
			scopeAttributeKeys: [],
			metricAttributeKeys: [],
		});
	});

	it("wipes selectedConfig so logs/metrics filters cannot leak across tabs", () => {
		const store = createStore();

		store.getState().filter.updateFilter("selectedConfig", {
			metricNames: ["up"],
			severities: ["error"],
			services: ["api"],
		});
		store.getState().filter.updateFilter("groupBy", "serviceName");

		prepareObservabilitySignalChange(
			store.getState().filter.updateConfig,
			store.getState().filter.updateFilter
		);

		expect(store.getState().filter.details.selectedConfig).toEqual({});
		expect(store.getState().filter.details.groupBy).toBeNull();
	});

	// E3: sort key applied on the previous tab gets reset so the
	// new tab doesn't try to ORDER BY a column it doesn't have.
	it("preserves agent scope fields when clearing signal filters", () => {
		const store = createStore();

		store.getState().filter.updateFilter("selectedConfig", {
			serviceNames: ["demo-openai-app"],
			environments: ["production"],
			metricNames: ["up"],
			severities: ["error"],
		});

		prepareObservabilitySignalChange(
			store.getState().filter.updateConfig,
			store.getState().filter.updateFilter,
			undefined,
			{
				serviceNames: ["demo-openai-app"],
				environments: ["production"],
			}
		);

		expect(store.getState().filter.details.selectedConfig).toEqual({
			serviceNames: ["demo-openai-app"],
			environments: ["production"],
		});
	});
});
