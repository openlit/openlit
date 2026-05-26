import { prepareObservabilitySignalChange } from "@/helpers/client/observability";
import { filterStoreSlice } from "@/store/filter";
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
});
