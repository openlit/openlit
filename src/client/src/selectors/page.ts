import { RootStore } from "@/store";
import { PAGE, REQUEST_VISIBILITY_COLUMNS } from "@/store/page";

export const getDashboardType = (state: RootStore) => state.page.dashboard.type;

export const getVisibilityColumnsOfPage = (state: RootStore, pageName: PAGE) =>
	(
		state.page[pageName] as {
			visibilityColumns: Partial<REQUEST_VISIBILITY_COLUMNS>;
		}
	).visibilityColumns;

export const setPageData = (state: RootStore) => state.page.setData;
