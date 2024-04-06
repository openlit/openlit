import { RootStore } from "@/store";

export const getFilterDetails = (state: RootStore) => state.filter.details;

export const getUpdateFilter = (state: RootStore) => state.filter.updateFilter;
