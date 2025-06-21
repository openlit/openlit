import { Input } from "@/components/ui/input";
import { useSetDashboardPageSearch } from "@/selectors/dashboards";
import { useDashboardPageSearch } from "@/selectors/dashboards";

export default function Search() {
	const pageSearch = useDashboardPageSearch();
	const setPageSearch = useSetDashboardPageSearch();

	return <Input
		placeholder="Search"
		value={pageSearch}
		onChange={(e) => setPageSearch(e.target.value)}
		className="w-[400px]"
	/>;
}