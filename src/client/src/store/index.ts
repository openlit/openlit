import { create } from "zustand";
import { UserStore, userStoreSlice } from "./user";
import { FilterStore, filterStoreSlice } from "./filter";
import { DatabaseStore, databaseConfigStoreSlice } from "./database-config";
import { withLenses } from "@dhmk/zustand-lens";
import { devtools } from "zustand/middleware";
import { EvaluateStore, evaluateStoreSlice } from "./evaluate";

export type RootStore = {
	user: UserStore;
	filter: FilterStore;
	databaseConfig: DatabaseStore;
	evaluate: EvaluateStore;
};

export const useRootStore = create<RootStore>()(
	devtools(
		withLenses({
			user: userStoreSlice,
			filter: filterStoreSlice,
			databaseConfig: databaseConfigStoreSlice,
			evaluate: evaluateStoreSlice,
		})
	)
);
