import { renderHook } from "@testing-library/react";
import { create } from "zustand";
import { withLenses } from "@dhmk/zustand-lens";
import {
	configToParams,
	paramsToConfig,
	useFilterUrlSync,
} from "@/components/(playground)/filter/traces-filter";
import { getFilterStorageKey } from "@/helpers/client/filter-persistence";
import { filterStoreSlice } from "@/store/filter";

jest.mock("next/navigation", () => ({
	useRouter: () => ({ replace: jest.fn() }),
	usePathname: () => "/",
}));

describe("traces filter URL mapping", () => {
	it("round-trips search", () => {
		const params = new URLSearchParams();

		configToParams({ search: "it's a & b" }, params);

		expect(paramsToConfig(new URLSearchParams(params.toString())).search).toBe("it's a & b");
	});

	it("removes the key when search is cleared", () => {
		const params = new URLSearchParams("search=refund");

		configToParams({ search: "" }, params);

		expect(params.has("search")).toBe(false);
	});
});

describe("useFilterUrlSync restore", () => {
	const restore = () => {
		const store = create<any>()(withLenses({ filter: filterStoreSlice }));
		const { updateFilter, details } = store.getState().filter;
		renderHook(() => useFilterUrlSync(details, updateFilter));
		return store.getState().filter.details;
	};

	beforeEach(() => {
		window.localStorage.clear();
		window.history.replaceState(null, "", "/");
	});

	it("keeps a search made inside a drill-down when read from the URL", () => {
		window.history.replaceState(null, "", "/?search=refund&gb=model&gbv=gpt-4");

		expect(restore()).toMatchObject({
			groupBy: "model",
			groupValue: "gpt-4",
			selectedConfig: { search: "refund" },
		});
	});

	it("keeps a search made inside a drill-down when read from storage", () => {
		window.localStorage.setItem(
			getFilterStorageKey(),
			JSON.stringify({
				timeLimitType: "24H",
				selectedConfig: { search: "refund" },
				groupBy: "model",
				groupValue: "gpt-4",
			})
		);

		expect(restore()).toMatchObject({
			groupBy: "model",
			groupValue: "gpt-4",
			selectedConfig: { search: "refund" },
		});
	});
});
