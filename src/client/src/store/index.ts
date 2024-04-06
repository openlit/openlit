import { create } from "zustand";
import { UserStore, userStoreSlice } from "./user";
import { FilterStore, filterStoreSlice } from "./filter";
import { withLenses } from "@dhmk/zustand-lens";
import { devtools } from "zustand/middleware";

export type RootStore = {
	user: UserStore;
	filter: FilterStore;
};

export const useRootStore = create<RootStore>()(
	devtools(
		withLenses({
			user: userStoreSlice,
			filter: filterStoreSlice,
		})
	)
);
