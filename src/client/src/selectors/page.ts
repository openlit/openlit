import { RootStore } from "@/types/store/root";
import { PAGE, REQUEST_VISIBILITY_COLUMNS } from "@/types/store/page";
import { useRootStore } from "@/store";

export const getDashboardType = (state: RootStore) => state.page.dashboard.type;

export const getVisibilityColumnsOfPage = (state: RootStore, pageName: PAGE) =>
	(
		state.page[pageName] as {
			visibilityColumns: Partial<REQUEST_VISIBILITY_COLUMNS>;
		}
	).visibilityColumns;

export const setPageData = (state: RootStore) => state.page.setData;

const getPageHeader = (state: RootStore) => state.page.header;

const setPageHeader = (state: RootStore) => state.page.setHeader;

export const usePageHeader = () => {
	const header = useRootStore(getPageHeader);
	const setHeader = useRootStore(setPageHeader);

	return { header, setHeader };
};
