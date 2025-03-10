import { Columns } from "@/components/data-table/columns";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TraceMapping } from "@/constants/traces";
import { getVisibilityColumnsOfPage, setPageData } from "@/selectors/page";
import { useRootStore } from "@/store";
import { PAGE, REQUEST_VISIBILITY_COLUMNS } from "@/types/store/page";
import { TraceMappingKeyType } from "@/types/trace";
import { objectEntries } from "@/utils/object";
import { EyeIcon } from "lucide-react";

export default function VisibilityColumns({
	columns,
	pageName,
}: {
	columns: Columns<any, any>;
	pageName: PAGE;
}) {
	const updateFilter = useRootStore(setPageData);
	const visibilityColumns = useRootStore((state) =>
		getVisibilityColumnsOfPage(state, pageName)
	);
	const onVisibilityChange = (key: TraceMappingKeyType, value: boolean) => {
		updateFilter(pageName, `visibilityColumns.${key}`, value);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 dark:bg-stone-800 dark:hover:bg-stone-900 aspect-square p-1 h-[30px] relative"
					variant="outline"
				>
					<EyeIcon className="w-3 h-3" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				{objectEntries(columns).map(([key, value]) => (
					<DropdownMenuItem
						key={key}
						onClick={() =>
							onVisibilityChange(
								key as TraceMappingKeyType,
								!visibilityColumns[key as keyof REQUEST_VISIBILITY_COLUMNS]
							)
						}
						disabled={!value?.enableHiding}
						className="gap-3"
					>
						<Checkbox
							checked={
								visibilityColumns[key as keyof REQUEST_VISIBILITY_COLUMNS]
							}
						/>
						{TraceMapping[key as TraceMappingKeyType].label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
