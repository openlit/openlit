import { prepareObservabilitySignalChange } from "@/helpers/client/observability";
import { DEFAULT_SORTING, filterStoreSlice } from "@/store/filter";
import { withLenses } from "@dhmk/zustand-lens";
import { create } from "zustand";

const createStore = () => create<any>()(withLenses({ filter: filterStoreSlice }));

describe("prepareObservabilitySignalChange", () => {
	it("clears available-options config and selected filters on signal change", () => {
		const updateConfig = jest.fn();
		const updateFilter = jest.fn();

		prepareObservabilitySignalChange(updateConfig, updateFilter);

		expect(updateConfig).toHaveBeenCalledWith(undefined);
		expect(updateFilter).toHaveBeenCalledWith("selectedConfig", {}, {
			clearFilter: true,
		});
		expect(updateFilter).toHaveBeenCalledWith("groupBy", null);
	});

	it("wipes selectedConfig so Traces filters cannot empty Exceptions", () => {
		const store = createStore();

		store.getState().filter.updateFilter("selectedConfig", {
			models: ["gpt-4o-mini"],
			providers: ["openai"],
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
	it("resets sorting and offset when changing signal", () => {
		const store = createStore();

		store.getState().filter.updateFilter("sorting", {
			type: "Tokens",
			direction: "asc",
		});
		store.getState().filter.updateFilter("offset", 50);

		prepareObservabilitySignalChange(
			store.getState().filter.updateConfig,
			store.getState().filter.updateFilter
		);

		expect(store.getState().filter.details.sorting).toEqual(DEFAULT_SORTING);
		expect(store.getState().filter.details.offset).toBe(0);
	});
});
