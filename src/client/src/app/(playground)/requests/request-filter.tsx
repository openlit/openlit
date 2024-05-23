import RequestPagination from "@/components/(playground)/request-pagination";
import { ceil } from "lodash";
import Filter from "../../../components/(playground)/filter";
import {
	getFilterConfig,
	getFilterDetails,
	getUpdateFilter,
} from "@/selectors/filter";
import { useRootStore } from "@/store";

export default function RequestFilter({ total }: { total: number }) {
	const filter = useRootStore(getFilterDetails);
	const filterConfig = useRootStore(getFilterConfig);
	const updateFilter = useRootStore(getUpdateFilter);
	const onClickPageAction = (dir: -1 | 1) => {
		updateFilter("offset", filter.offset + dir * filter.limit);
	};

	const onClickPageLimit = (size: number) => {
		updateFilter("limit", size);
	};

	return (
		<div className="flex items-center w-full justify-between">
			<Filter showDynamicFilters>
				{filterConfig && (
					<RequestPagination
						currentPage={filter.offset / filter.limit + 1}
						currentSize={filter.limit}
						totalPage={ceil((total || 0) / filter.limit)}
						onClickPageAction={onClickPageAction}
						onClickPageLimit={onClickPageLimit}
					/>
				)}
			</Filter>
		</div>
	);
}
