import { create } from "zustand";
import { UserStore, userStoreSlice } from "./user";
import { FilterStore, filterStoreSlice } from "./filter";
import { DatabaseStore, databaseConfigStoreSlice } from "./database-config";
import { withLenses } from "@dhmk/zustand-lens";
import { devtools } from "zustand/middleware";
import { OpengroundStore, opengroundStoreSlice } from "./openground";

export type RootStore = {
	user: UserStore;
	filter: FilterStore;
	databaseConfig: DatabaseStore;
	openground: OpengroundStore;
};

export const useRootStore = create<RootStore>()(
	devtools(
		withLenses({
			user: userStoreSlice,
			filter: filterStoreSlice,
			databaseConfig: databaseConfigStoreSlice,
			openground: opengroundStoreSlice,
		})
	)
);
