import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Trash2 } from "lucide-react";
import ShareDialog from "./share-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { DatabaseConfigTabsProps } from "@/types/database-config";

const ADD_NEW_ID = "ADD_NEW_ID";

const getCommonCardClasses = (isActive: boolean) =>
	`item-element-card flex flex-col p-4 text-sm cursor-pointer relative group w-64 hover:bg-stone-100 dark:hover:bg-stone-700 ${
		isActive ? "bg-stone-100 dark:bg-stone-700" : ""
	}`;

export default function DatabaseConfigTabs({
	items,
	onClickTab,
	selectedTabId,
	onClickItemDelete,
	onClickItemChangeActive,
	addButton,
}: DatabaseConfigTabsProps) {
	return (
		<div className="flex flex-col overflow-hidden border-r dark:border-stone-800">
			{addButton && (
				<>
					<div
						className={`${getCommonCardClasses(
							selectedTabId === ADD_NEW_ID
						)} items-center justify-center text-stone-400 dark:text-stone-400 shrink-0`}
						data-item-id={ADD_NEW_ID}
						onClick={onClickTab}
					>
						Add new
					</div>
					<hr className="dark:border-stone-800" />
				</>
			)}
			<div className="flex flex-col overflow-y-auto">
				{items.map((item) => (
					<Fragment key={item.id}>
						<div
							className={getCommonCardClasses(selectedTabId === item.id)}
							data-item-id={item.id}
							onClick={onClickTab}
						>
							<div className="flex w-full">
								<div className={`flex flex-col grow`}>
									<span className="text-ellipsis overflow-hidden whitespace-nowrap mb-3 text-stone-400 dark:text-stone-400">
										{item.name}
									</span>
									{item.badge && (
										<Badge
											variant="default"
											className={`mr-auto ${
												item.isCurrent
													? "border-primary bg-primary text-white dark:border-primary dark:bg-primary dark:text-white hover:bg-primary dark:hover:bg-primary"
													: ""
											}`}
										>
											{item.badge}
										</Badge>
									)}
								</div>
								<div className="flex flex-col h-full space-y-1 items-end">
									<Tooltip>
										<TooltipTrigger asChild>
											<div onClick={onClickItemChangeActive}>
												<Checkbox
													checked={!!item.isCurrent}
													className="data-[state=checked]:bg-primary dark:data-[state=checked]:bg-primary text-white data-[state=checked]:border-primary dark:data-[state=checked]:border-primary data-[state=checked]:ring-offset-primary dark:text-white data-[state=checked]:text-white dark:data-[state=checked]:text-white"
												/>
											</div>
										</TooltipTrigger>
										<TooltipContent side="bottom" sideOffset={5}>
											Mark {item.name} as the active database config
										</TooltipContent>
									</Tooltip>
									{item.canDelete && onClickItemDelete && (
										<Trash2
											className="w-3 h-3 hidden group-hover:inline text-stone-900 dark:text-stone-100"
											onClick={onClickItemDelete}
										/>
									)}
									{item.canShare && (
										<ShareDialog
											id={item.id}
											permissions={{
												canEdit: item.canEdit,
												canDelete: item.canDelete,
												canShare: item.canShare,
											}}
										/>
									)}
								</div>
							</div>
						</div>
						<hr className="dark:border-stone-800" />
					</Fragment>
				))}
			</div>
		</div>
	);
}
