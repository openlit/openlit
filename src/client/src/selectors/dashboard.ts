import { RootStore } from "@/store";

export const getDashboardType = (state: RootStore) => state.dashboard.type;

export const setDashboardType = (state: RootStore) => state.dashboard.setType;
