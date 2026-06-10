import { prepareObservabilitySignalChange } from "@/helpers/client/observability";
import { DEFAULT_SORTING, filterStoreSlice } from "@/store/filter";
import { withLenses } from "@dhmk/zustand-lens";
import { create } from "zustand";

const createStore = () => create<any>()(withLenses({ filter: filterStoreSlice }));

describe("prepareObservabilitySignalChange", () => {
	it("clears transient grouping state without clearing selected filters", () => {
		const updateConfig = jest.fn();
		const updateFilter = jest.fn();

		prepareObservabilitySignalChange(updateConfig, updateFilter);

		expect(updateConfig).toHaveBeenCalledWith(undefined);
		expect(updateFilter).toHaveBeenCalledWith("groupBy", null);
		expect(updateFilter).not.toHaveBeenCalledWith(
			"selectedConfig",
			expect.anything(),
			expect.anything()
		);
		expect(updateFilter).not.toHaveBeenCalledWith(
			"selectedConfig",
			expect.anything()
		);
	});

	it("preserves selectedConfig when applied to the filter store", () => {
		const store = createStore();

		store.getState().filter.updateFilter("selectedConfig", {
			models: ["gpt-4o-mini"],
			services: ["api"],
		});
		store.getState().filter.updateFilter("groupBy", "serviceName");

		prepareObservabilitySignalChange(
			store.getState().filter.updateConfig,
			store.getState().filter.updateFilter
		);

		expect(store.getState().filter.details.selectedConfig).toEqual({
			models: ["gpt-4o-mini"],
			services: ["api"],
		});
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
