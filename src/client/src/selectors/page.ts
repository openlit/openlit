import { RootStore } from "@/types/store/root";
import { PAGE, REQUEST_VISIBILITY_COLUMNS } from "@/types/store/page";

export const getDashboardType = (state: RootStore) => state.page.dashboard.type;

export const getVisibilityColumnsOfPage = (state: RootStore, pageName: PAGE) =>
	(
		state.page[pageName] as {
			visibilityColumns: Partial<REQUEST_VISIBILITY_COLUMNS>;
		}
	).visibilityColumns;

export const setPageData = (state: RootStore) => state.page.setData;
