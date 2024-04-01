import Pagination from "@/components/common/pagination";
import { ceil } from "lodash";
import Filter from "../../../components/(playground)/filter";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";

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
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);
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
