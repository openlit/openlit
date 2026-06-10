import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getTraceMappingKeyFullPath } from "@/helpers/client/trace";
import { getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { FilterSorting } from "@/types/store/filter";
import { ArrowDownIcon, ArrowDownUpIcon, ArrowUpIcon } from "lucide-react";

const SORTING_TYPES = [
	{ key: "Timestamp", label: "Timestamp" },
	{
		key: `SpanAttributes['${getTraceMappingKeyFullPath("cost")}']`,
		label: "Cost",
	},
	{
		key: `SpanAttributes['${getTraceMappingKeyFullPath("totalTokens")}']`,
		label: "Total tokens",
	},
	{
		key: `SpanAttributes['${getTraceMappingKeyFullPath("promptTokens")}']`,
		label: "Prompt tokens",
	},
];

export type SortOption = { key: string; label: string };

export default function Sorting({
	sorting,
	includeOnlySorting,
	customOptions,
}: {
	sorting: FilterSorting;
	includeOnlySorting?: string[];
	// `customOptions` lets a signal override the OTel-attribute
	// driven defaults with its own aggregation-level keys (e.g.
	// "cost", "tokens", "sessions"). When set, the API for that
	// signal interprets `filter.sorting.type` as one of these keys
	// and maps it to its underlying ClickHouse column.
	customOptions?: SortOption[];
}) {
	const updateFilter = useRootStore(getUpdateFilter);
	const onSortingChange = (type: string) => {
		const updatedSorting: FilterSorting = { type, direction: "desc" };
		if (sorting.type === type) {
			if (sorting.direction === "asc") updatedSorting.direction = "desc";
			else updatedSorting.direction = "asc";
		}
		updateFilter("sorting", updatedSorting);
	};

	const sortingOptions = customOptions?.length
		? customOptions
		: includeOnlySorting?.length
			? SORTING_TYPES.filter((i) => includeOnlySorting.includes(i.key))
			: SORTING_TYPES;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 dark:bg-stone-800 dark:hover:bg-stone-900 aspect-square p-1 h-[30px] relative"
					variant="outline"
				>
					<ArrowDownUpIcon className="w-3 h-3" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				{sortingOptions.map(({ key, label }) => (
					<DropdownMenuItem key={key} onClick={() => onSortingChange(key)}>
						{label}
						{key === sorting.type &&
							(sorting.direction === "asc" ? (
								<ArrowUpIcon className="h-3 w-3 ml-auto" />
							) : (
								<ArrowDownIcon className="h-3 w-3 ml-auto" />
							))}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
