"use client";

import { Input } from "@/components/ui/input";
import {
	useDashboardPageSearch,
	useSetDashboardPageSearch,
} from "@/selectors/dashboards";
import { cn } from "@/lib/utils";

export default function Search({ className }: { className?: string }) {
	const pageSearch = useDashboardPageSearch();
	const setPageSearch = useSetDashboardPageSearch();

	return (
		<Input
			placeholder="Search"
			value={pageSearch}
			onChange={(e) => setPageSearch(e.target.value)}
			className={cn("h-8 w-48 bg-white dark:bg-stone-950", className)}
		/>
	);
}
