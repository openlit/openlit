import { MouseEventHandler } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Trash2 } from "lucide-react";

export type SideTabItemProps = {
	id: string;
	name: string;
	badge?: string;
	isCurrent?: boolean;
	enableDeletion?: boolean;
	enableActiveChange?: boolean;
};

export type SideTabsProps = {
	items: SideTabItemProps[];
	onClickTab: MouseEventHandler<HTMLElement>;
	selectedTabId: string;
	onClickItemDelete?: MouseEventHandler<SVGSVGElement>;
	onClickItemChangeActive?: MouseEventHandler<HTMLDivElement>;
	addButton?: boolean;
};

const ADD_NEW_ID = "ADD_NEW_ID";

const getCommonCardClasses = (isActive: boolean) =>
	`item-element-card flex flex-col p-4 text-sm cursor-pointer relative group w-64 hover:bg-stone-100 dark:hover:bg-stone-700 ${
		isActive ? "bg-stone-100 dark:bg-stone-700" : ""
	}`;

export default function SideTabs({
	items,
	onClickTab,
	selectedTabId,
	onClickItemDelete,
	onClickItemChangeActive,
	addButton,
}: SideTabsProps) {
	return (
		<div className="grid grid-flow-col">
			<ul className="grid grid-flow-col gap-4 shrink-0 w-full overflow-y-auto">
				{items.map((item) => (
					<Card
						className={getCommonCardClasses(selectedTabId === item.id)}
						data-item-id={item.id}
						key={item.id}
						onClick={onClickTab}
					>
						<li className={`flex flex-col `}>
							<span className="text-ellipsis overflow-hidden whitespace-nowrap mb-3">
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
							{item.enableDeletion && onClickItemDelete && (
								<Trash2
									className="w-3 h-3 absolute right-4 top-4 hidden group-hover:inline text-stone-400 dark:text-white"
									onClick={onClickItemDelete}
								/>
							)}
							{item.enableActiveChange && onClickItemChangeActive && (
								<Tooltip>
									<TooltipTrigger asChild>
										<div
											className="absolute right-1 bottom-3 inline scale-50"
											onClick={onClickItemChangeActive}
										>
											<Switch
												className="data-[state=checked]:bg-primary dark:data-[state=checked]:bg-primary"
												thumbClassName="bg-white dark:bg-white"
												checked={!!item.isCurrent}
											/>
										</div>
									</TooltipTrigger>
									<TooltipContent side="bottom" sideOffset={5}>
										Mark {item.name} as the active database config
									</TooltipContent>
								</Tooltip>
							)}
						</li>
					</Card>
				))}
			</ul>
			{addButton && (
				<Card
					className={`${getCommonCardClasses(
						selectedTabId === ADD_NEW_ID
					)} items-center justify-center text-stone-400 dark:text-stone-400`}
					data-item-id={ADD_NEW_ID}
					onClick={onClickTab}
				>
					Add new
				</Card>
			)}
		</div>
	);
}
