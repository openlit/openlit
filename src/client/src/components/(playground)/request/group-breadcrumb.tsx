"use client";
import { ChevronRight, X } from "lucide-react";
import { getGroupByLabel } from "./grouped-table";

export default function GroupBreadcrumb({
	groupBy,
	groupValue,
	rootLabel = "All Requests",
	updateFilter,
}: {
	groupBy: string;
	groupValue?: string;
	rootLabel?: string;
	updateFilter: (key: string, value: any) => void;
}) {
	const groupLabel = getGroupByLabel(groupBy);

	const handleX = () => {
		if (groupValue) {
			updateFilter("groupValue", null);
		} else {
			updateFilter("groupBy", null);
		}
	};

	return (
		<div className="flex items-center gap-1.5 mb-3 text-xs select-none">
			<button
				onClick={() => { updateFilter("groupValue", null); updateFilter("groupBy", null); }}
				className="text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
			>
				{rootLabel}
			</button>

			<ChevronRight className="w-3 h-3 text-stone-300 dark:text-stone-600 shrink-0" />

			{groupValue ? (
				<button
					onClick={() => updateFilter("groupValue", null)}
					className="text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
				>
					{groupLabel}
				</button>
			) : (
				<span className="font-medium text-stone-700 dark:text-stone-200">{groupLabel}</span>
			)}

			{groupValue && (
				<>
					<ChevronRight className="w-3 h-3 text-stone-300 dark:text-stone-600 shrink-0" />
					<span className="font-medium text-stone-700 dark:text-stone-200 truncate max-w-[240px]">
						{groupValue}
					</span>
				</>
			)}

			<button
				onClick={handleX}
				title={groupValue ? "Back to groups" : "Remove grouping"}
				className="ml-0.5 p-0.5 rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors shrink-0"
			>
				<X className="w-3 h-3" />
			</button>
		</div>
	);
}
