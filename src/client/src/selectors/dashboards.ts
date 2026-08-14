import { useRootStore } from "@/store";

export const useDashboardPageSearch = () =>
	useRootStore((state) => state.dashboards.page.search);

export const useSetDashboardPageSearch = () =>
	useRootStore((state) => state.dashboards.setPageSearch);
