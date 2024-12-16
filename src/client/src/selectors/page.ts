import { RootStore } from "@/store";

export const getDashboardType = (state: RootStore) => state.page.dashboard.type;

export const getRequestVisibilityColumns = (state: RootStore) =>
	state.page.request.visibilityColumns;

export const setPageData = (state: RootStore) => state.page.setData;
