"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
	ChevronRight,
	Search,
	X,
} from "lucide-react";
import Otter from "@/components/svg/otter";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SIDEBAR_ITEMS, COMPACT_SIDEBAR_ICON_CLASS, COMPACT_SIDEBAR_SEARCH_ICON_CLASS } from "@/constants/sidebar";
import { cn } from "@/lib/utils";
import { getCurrentUserId } from "@/selectors/user";
import { useRootStore } from "@/store";
import {
	SidebarActionItem,
	SidebarItemProps,
	SidebarSection,
} from "@/types/sidebar";
import { useSidebarPreferences } from "@/utils/hooks/useSidebarPreferences";
import UserActions from "./user-actions";
import OtterSidebar from "./otter-sidebar";
import ThemeToggleSwitch from "./theme-switch";
import MyApps from "./my-apps";
import { useSidebarLayout } from "../sidebar-layout-context";

const isActive = (pathname: string, item: SidebarActionItem, currentUrl: string) => {
	if (!item.link) return false;
	if (item.link.includes("?")) return currentUrl.startsWith(item.link);
	if (item.link === "/dashboards") return pathname.startsWith("/dashboards") || pathname.startsWith("/d/");
	if (item.link === "/dashboard") return pathname.startsWith("/dashboard") && !pathname.startsWith("/dashboards");
	return pathname.startsWith(item.link);
};

const flatItems = (items: SidebarItemProps[]) =>
	items.flatMap((item) => {
		if (item.type !== "section") return [item];
		const direct = item.children || [];
		const grouped = (item.groups || []).flatMap((group) => group.children);
		return [...direct, ...grouped];
	});

const SECONDARY_PANEL_WIDTH = "min(20rem, calc(100vw - 4rem))";

function NavigationLink({
	item,
	active,
	onNavigate,
	compact = false,
}: {
	item: SidebarActionItem;
	active: boolean;
	onNavigate?: () => void;
	compact?: boolean;
}) {
	const content = <>
		{item.icon}
		<span className={cn("min-w-0 truncate", compact && "sr-only")}>{item.text}</span>
	</>;
	const className = cn(
		"flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[13px] font-medium transition-colors",
		compact && "justify-center px-2",
		compact && COMPACT_SIDEBAR_ICON_CLASS,
		active
			? "bg-stone-200 text-stone-950 dark:bg-stone-800 dark:text-white"
			: "text-stone-600 hover:bg-stone-200/70 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white",
	);

	if (item.component) return item.component;
	if (item.link && !item.target) {
		return <Link href={item.link} onClick={onNavigate} className={className}>{content}</Link>;
	}
	return (
		<a href={item.link} target={item.target} onClick={() => { item.onClick?.(); onNavigate?.(); }} className={className}>
			{content}
		</a>
	);
}

function PrimaryItem({
	item,
	pathname,
	currentUrl,
	compact,
	openSection,
	setOpenSection,
}: {
	item: SidebarItemProps;
	pathname: string;
	currentUrl: string;
	compact: boolean;
	openSection: string | null;
	setOpenSection: (section: SidebarSection | null) => void;
}) {
	if (item.type === "action") {
		const active = openSection ? false : isActive(pathname, item, currentUrl);
		const link = <NavigationLink item={item} active={active} compact={compact} onNavigate={() => setOpenSection(null)} />;
		return compact ? <Tooltip delayDuration={100}><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right" sideOffset={8}>{item.text}</TooltipContent></Tooltip> : link;
	}

	const selected = openSection === item.title;
	return (
		<Tooltip delayDuration={100}>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					aria-expanded={openSection === item.title}
					onClick={() => setOpenSection(openSection === item.title ? null : item)}
					className={cn(
							"h-8 w-full justify-start gap-1.5 rounded-lg px-2 text-[13px] font-medium",
						compact && "justify-center px-2",
						compact && COMPACT_SIDEBAR_ICON_CLASS,
						selected
							? "bg-stone-200 text-stone-950 hover:bg-stone-200 dark:bg-stone-800 dark:text-white dark:hover:bg-stone-800"
							: "text-stone-600 hover:bg-stone-200/70 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white",
					)}
				>
					{compact ? (item.icon ?? <span className="text-[13px] font-bold">{item.title.slice(0, 1)}</span>) : <>{item.icon}<span>{item.title}</span><ChevronRight className="ml-auto size-4" /></>}
				</Button>
			</TooltipTrigger>
			{compact && <TooltipContent side="right" sideOffset={8}>{item.title}</TooltipContent>}
		</Tooltip>
	);
}

function SectionPanel({ section, pathname, currentUrl, onClose }: { section: SidebarSection; pathname: string; currentUrl: string; onClose: () => void }) {
	const children = section.children || [];
	const groups = section.groups;

	return (
		<div
			className="absolute inset-y-0 left-full z-40 flex flex-col border-y border-r border-stone-200 bg-stone-50 shadow-xl dark:border-stone-800 dark:bg-stone-950"
			style={{ width: SECONDARY_PANEL_WIDTH }}
		>
			<div className="flex items-center justify-between border-b border-stone-200 px-3 py-2.5 dark:border-stone-800">
				<div className="flex items-center gap-2 text-stone-900 dark:text-white">
					{section.icon}
						<p className="text-[15px] font-semibold">{section.title}</p>
				</div>
				<Button variant="ghost" size="icon" onClick={onClose} aria-label="Close navigation panel" className="size-8 text-stone-700 hover:bg-stone-200 dark:text-stone-200 dark:hover:bg-stone-800"><X className="size-4" /></Button>
			</div>
				<div className="scrollbar-hidden overflow-y-auto p-2">
				{groups ? (
					<div className="space-y-3">
						{groups.map((group) => (
							<div key={group.title} className="space-y-0.5">
									<p className="px-2.5 pb-0.5 pt-1 text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">{group.title}</p>
								{group.children.map((item) => <NavigationLink key={item.text} item={item} active={isActive(pathname, item, currentUrl)} onNavigate={onClose} />)}
							</div>
						))}
					</div>
				) : (
					<div className="space-y-1">
						{children.map((item) => <NavigationLink key={item.text} item={item} active={isActive(pathname, item, currentUrl)} onNavigate={onClose} />)}
					</div>
				)}
			</div>
			{section.title === "Settings" ? <div className="flex items-center justify-between border-t border-stone-200 px-3 py-2.5 dark:border-stone-800"><span className="text-[13px] font-medium text-stone-600 dark:text-stone-300">Appearance</span><ThemeToggleSwitch /></div> : null}
		</div>
	);
}

export default function Sidebar() {
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const { isExpanded } = useSidebarLayout();
	const [openSection, setOpenSection] = useState<SidebarSection | null>(null);
	const [commandOpen, setCommandOpen] = useState(false);
	const userId = useRootStore(getCurrentUserId);
	const currentUrl = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;
	const allItems = useMemo(() => flatItems(SIDEBAR_ITEMS), []);
	const appGroups = useMemo(() => {
		const section = SIDEBAR_ITEMS.find(
			(item): item is SidebarSection => item.type === "section" && Boolean(item.groups)
		);
		return section?.groups ?? [];
	}, []);
	const appsSectionIcon = useMemo(() => {
		const section = SIDEBAR_ITEMS.find(
			(item): item is SidebarSection => item.type === "section" && item.title === "Apps"
		);
		return section?.icon;
	}, []);
	const appItems = useMemo(
		() => appGroups.flatMap((group) => group.children).filter((item) => item.link && !item.target),
		[appGroups]
	);
	const myApps = useSidebarPreferences(userId);
	const { loaded: myAppsLoaded, show: showMyApp } = myApps;
	const isOtterActive = pathname.startsWith("/chat");

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setCommandOpen(true);
			}
			if (event.key === "Escape") setOpenSection(null);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		if (!myAppsLoaded) return;
		const visitedApp = [...appItems]
			.sort((a, b) => (b.link?.length || 0) - (a.link?.length || 0))
			.find((item) => isActive(pathname, item, currentUrl));
		if (visitedApp?.link) showMyApp(visitedApp.link);
	}, [appItems, pathname, currentUrl, myAppsLoaded, showMyApp]);

	return (
		<aside aria-label="Main navigation" className="relative flex h-full min-h-0 w-full flex-col bg-stone-50 dark:bg-stone-950">
			{openSection && (
				<button
					aria-label="Close navigation panel"
					className="fixed inset-y-0 left-0 right-0 z-30 cursor-default bg-black/20 dark:bg-stone-900/40"
					onClick={() => setOpenSection(null)}
				/>
			)}
			<div data-state={isExpanded ? "open" : "closed"} className="relative z-40 flex h-full min-h-0 flex-col">
				<div className="px-2 pb-3 pt-3">
					<Button variant="outline" onClick={() => setCommandOpen(true)} className={cn("h-9 w-full justify-start gap-1.5 border-stone-200 bg-transparent px-2.5 text-[13px] text-stone-500 shadow-none hover:bg-stone-200/60 dark:border-stone-800 dark:hover:bg-stone-800/60", !isExpanded && "justify-center px-2", !isExpanded && COMPACT_SIDEBAR_SEARCH_ICON_CLASS)} aria-label="Search navigation">
						<Search className="size-4 shrink-0" />
						<span className={cn("flex-1 text-left", !isExpanded && "hidden")}>Search data</span>
						<kbd className={cn("rounded border border-stone-200 px-1 py-0.5 text-[10px] dark:border-stone-700", !isExpanded && "hidden")}>⌘K</kbd>
					</Button>
				</div>

				{isExpanded && (
					<div className="mx-2 grid grid-cols-2 gap-1">
							<Button variant="ghost" className={cn("h-8 rounded-lg px-2 text-[13px] text-stone-600 hover:bg-stone-200/70 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white", !openSection && !pathname.startsWith("/chat") && "bg-stone-200 text-stone-950 dark:bg-stone-800 dark:text-white")} onClick={() => { setOpenSection(null); router.push("/home"); }} aria-label="Browse">
							<span>Browse</span>
						</Button>
							<Link href="/chat" className={cn("flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-stone-600 hover:bg-stone-200/70 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white", !openSection && isOtterActive && "bg-stone-200 text-stone-950 dark:bg-stone-800 dark:text-white")}><Otter className="size-4 shrink-0" />Otter</Link>
					</div>
				)}

					{isOtterActive && isExpanded ? <div className="min-h-0 grow"><OtterSidebar /></div> : <nav className="scrollbar-hidden flex grow flex-col gap-1 overflow-y-auto px-2 py-4" aria-label="Product navigation">
					{SIDEBAR_ITEMS.map((item) => <PrimaryItem key={item.type === "section" ? item.title : item.text} item={item} pathname={pathname} currentUrl={currentUrl} compact={!isExpanded} openSection={openSection?.title || null} setOpenSection={setOpenSection} />)}
					<MyApps
						groups={appGroups}
						icon={appsSectionIcon}
						preferences={myApps}
						compact={!isExpanded}
						isActive={(item) => !openSection && isActive(pathname, item, currentUrl)}
						onNavigate={() => setOpenSection(null)}
					/>
				</nav>}
				<div className="border-t border-stone-200 p-2 dark:border-stone-800"><UserActions /></div>
			</div>
			{openSection && <SectionPanel section={openSection} pathname={pathname} currentUrl={currentUrl} onClose={() => setOpenSection(null)} />}

			<CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
				<CommandInput placeholder="Search OpenLIT navigation..." />
				<CommandList>
					<CommandEmpty>No navigation items found.</CommandEmpty>
					<CommandGroup heading="Navigation">
						{allItems.filter((item) => item.link).map((item) => <CommandItem key={item.text} value={item.text} onSelect={() => setCommandOpen(false)} asChild><Link href={item.link || "#"} className="gap-3">{item.icon}<span>{item.text}</span></Link></CommandItem>)}
					</CommandGroup>
				</CommandList>
			</CommandDialog>
		</aside>
	);
}
