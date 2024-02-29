import { CheckIcon, TrashIcon } from "@heroicons/react/24/outline";
import { MouseEventHandler } from "react";

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
};

export default function SideTabs({
	items,
	onClickTab,
	selectedTabId,
	onClickItemDelete,
	onClickItemChangeActive,
}: SideTabsProps) {
	return (
		<ul className="shrink-0 w-1/5 border-r border-secondary overflow-y-auto">
			{items.map((item) => (
				<li
					key={item.id}
					className={`flex flex-col p-2 text-sm cursor-pointer border-b border-secondary relative group hover:bg-secondary/[0.3] ${
						selectedTabId === item.id
							? "bg-secondary/[0.5] text-primary"
							: "bg-tertiary/[0.02] text-tertiary/[0.8]"
					}`}
					data-item-id={item.id}
					onClick={onClickTab}
				>
					{selectedTabId === item.id && (
						<span className="absolute h-full right-0 top-0 w-0.5 bg-primary" />
					)}
					<span className="text-ellipsis overflow-hidden whitespace-nowrap">
						{item.name}
					</span>
					{item.badge && (
						<span
							className={`mt-1 space-x-1 px-3 py-1 rounded-full text-xs font-medium max-w-fit ${
								selectedTabId === item.id
									? "bg-primary/[0.1] text-primary"
									: "bg-tertiary/[0.1] text-tertiary/[0.5]"
							}`}
						>
							{item.badge}
						</span>
					)}
					{item.enableDeletion && onClickItemDelete && (
						<TrashIcon
							className="w-3 h-3 absolute right-2 top-2 hidden group-hover:inline text-tertiary/[0.6] hover:text-primary"
							onClick={onClickItemDelete}
						/>
					)}
					{item.enableActiveChange && onClickItemChangeActive && (
						<div
							className={`flex items-center justify-center w-4 h-4 absolute right-2 bottom-2 border  rounded-full cursor-pointer ${
								item.isCurrent
									? "border-primary bg-primary text-white"
									: "border-tertiary/[0.3]"
							}`}
							onClick={onClickItemChangeActive}
						>
							{item.isCurrent && <CheckIcon className="w-3 h-3" />}
						</div>
					)}
				</li>
			))}
		</ul>
	);
}
