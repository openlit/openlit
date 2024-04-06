import Pagination from "@/components/common/pagination";
import Filter from "../filter";
import { useFilter } from "../filter-context";
import { ceil } from "lodash";

export type FilterConfigProps = {
	endpoints: string[];
	maxUsageCost: number;
	models: string[];
	totalRows: number;
};

export default function RequestFilter({
	config,
}: {
	config: FilterConfigProps | undefined;
}) {
	const [filter, updateFilter] = useFilter();
	const onClickPageAction = (dir: -1 | 1) => {
		updateFilter("offset", filter.offset + dir * filter.limit);
	};

	const onClickPageLimit = (size: number) => {
		updateFilter("limit", size);
	};

	return (
		<div className="flex items-center w-full">
			<Filter />
			{config && (
				<div className="flex flex-grow justify-end pr-2">
					<Pagination
						currentPage={filter.offset / filter.limit + 1}
						currentSize={filter.limit}
						totalPage={ceil((config.totalRows || 0) / filter.limit)}
						onClickPageAction={onClickPageAction}
						onClickPageLimit={onClickPageLimit}
					/>
				</div>
			)}
		</div>
	);
}
