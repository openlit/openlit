"use client";

import Link from "next/link";
import { type ReactElement, useState } from "react";
import {
	Check,
	Copy,
	ExternalLink,
	MoreHorizontal,
	Pencil,
	Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SidebarActionItem, SidebarGroup } from "@/types/sidebar";

type MyAppsPreferences = {
	loaded: boolean;
	isHidden: (link: string) => boolean;
	hide: (link: string) => void;
	toggle: (link: string) => void;
};

const rowClassName = (active: boolean) =>
	cn(
		"flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
		active
			? "bg-stone-200 text-stone-950 dark:bg-stone-800 dark:text-white"
			: "text-stone-600 hover:bg-stone-200/70 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white"
	);

function copyLink(link: string) {
	try {
		const absolute = new URL(link, window.location.origin).toString();
		navigator.clipboard.writeText(absolute);
		toast.success("Link copied to clipboard");
	} catch {
		toast.error("Could not copy link");
	}
}

function AppRow({
	item,
	active,
	onNavigate,
	onRemove,
}: {
	item: SidebarActionItem;
	active: boolean;
	onNavigate: () => void;
	onRemove: (link: string) => void;
}) {
	const link = item.link ?? "#";

	return (
		<div className="group/app relative flex items-center">
			<Link href={link} onClick={onNavigate} aria-current={active ? "page" : undefined} className={rowClassName(active)}>
				{item.icon}
				<span className="min-w-0 truncate">{item.text}</span>
			</Link>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label={`Options for ${item.text}`}
						className="absolute right-1 size-7 text-stone-400 opacity-0 transition-opacity hover:bg-stone-200 hover:text-stone-700 focus-visible:opacity-100 group-hover/app:opacity-100 data-[state=open]:opacity-100 dark:hover:bg-stone-800 dark:hover:text-stone-200"
						onClick={(event) => event.stopPropagation()}
					>
						<MoreHorizontal className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent side="right" align="start" className="w-56">
					<DropdownMenuItem
						className="gap-2 text-xs"
						onClick={() =>
							window.open(link, "_blank", "noopener,noreferrer")
						}
					>
						<ExternalLink className="size-4" />
						Open link in new browser tab
					</DropdownMenuItem>
					<DropdownMenuItem
						className="gap-2 text-xs"
						onClick={() => copyLink(link)}
					>
						<Copy className="size-4" />
						Copy link address
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						className="gap-2 text-xs text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
						onClick={() => onRemove(link)}
					>
						<Trash2 className="size-4" />
						Remove from sidebar
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function EditRow({
	item,
	checked,
	onToggle,
}: {
	item: SidebarActionItem;
	checked: boolean;
	onToggle: (link: string) => void;
}) {
	const link = item.link ?? "#";

	return (
		<label className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium text-stone-600 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800">
			<Checkbox
				checked={checked}
				onCheckedChange={() => onToggle(link)}
				aria-label={`${checked ? "Remove" : "Add"} ${item.text}`}
			/>
			{item.icon}
			<span className="min-w-0 truncate">{item.text}</span>
		</label>
	);
}

export default function MyApps({
	groups,
	icon,
	preferences,
	compact,
	isActive,
	onNavigate,
}: {
	groups: SidebarGroup[];
	icon?: ReactElement;
	preferences: MyAppsPreferences;
	compact: boolean;
	isActive: (item: SidebarActionItem) => boolean;
	onNavigate: () => void;
}) {
	const { loaded, isHidden, hide, toggle } = preferences;
	const [editing, setEditing] = useState(false);

	const linkedGroups = groups
		.map((group) => ({
			title: group.title,
			children: group.children.filter((item) => item.link && !item.target),
		}))
		.filter((group) => group.children.length > 0);

	const hasAnyVisible = linkedGroups.some((group) =>
		group.children.some((item) => !isHidden(item.link!))
	);

	if (!loaded) {
		return null;
	}

	if (compact) {
		if (!hasAnyVisible) {
			return null;
		}
		return (
			<div className="mt-2 flex flex-col gap-1 border-t border-stone-200 pt-2 dark:border-stone-800">
				{linkedGroups
					.flatMap((group) => group.children)
					.filter((item) => !isHidden(item.link!))
					.map((item) => (
						<Tooltip key={item.link} delayDuration={100}>
							<TooltipTrigger asChild>
								<Link
									href={item.link!}
									onClick={onNavigate}
									aria-current={isActive(item) ? "page" : undefined}
									className={cn(
										"flex w-full items-center justify-center rounded-lg px-2.5 py-2 transition-colors",
										isActive(item)
											? "bg-stone-200 text-stone-950 dark:bg-stone-800 dark:text-white"
											: "text-stone-600 hover:bg-stone-200/70 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white"
									)}
								>
									{item.icon}
								</Link>
							</TooltipTrigger>
							<TooltipContent side="right" sideOffset={8}>
								{item.text}
							</TooltipContent>
						</Tooltip>
					))}
			</div>
		);
	}

	return (
		<div className="mt-2 border-t border-stone-200 pt-2 dark:border-stone-800">
			<div className="flex items-center justify-between px-2 pb-1">
					<div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
					{icon}
					<span>My apps</span>
				</div>
				<Button
					variant="ghost"
					size="icon"
					onClick={() => setEditing((value) => !value)}
					aria-label={editing ? "Done editing my apps" : "Edit my apps"}
					aria-pressed={editing}
					className="size-7 text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
				>
					{editing ? <Check className="size-4" /> : <Pencil className="size-4" />}
				</Button>
			</div>

			{!editing && !hasAnyVisible ? (
				<p className="px-2.5 py-1 text-xs text-stone-500 dark:text-stone-400">
					Open an app to add it back here.
				</p>
			) : null}

			{linkedGroups.map((group) => {
				const visible = editing
					? group.children
					: group.children.filter((item) => !isHidden(item.link!));
				if (visible.length === 0) return null;

				return (
					<div key={group.title} className="mb-1.5">
							<p className="px-2.5 pb-0.5 pt-1 text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
							{group.title}
						</p>
						{visible.map((item) =>
							editing ? (
								<EditRow
									key={item.link}
									item={item}
									checked={!isHidden(item.link!)}
									onToggle={toggle}
								/>
							) : (
								<AppRow
									key={item.link}
									item={item}
									active={isActive(item)}
									onNavigate={onNavigate}
									onRemove={hide}
								/>
							)
						)}
					</div>
				);
			})}
		</div>
	);
}
