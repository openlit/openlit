"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
	ChevronRight,
	ChevronsLeft,
	ChevronsRight,
	LayoutGrid,
	MessageSquareText,
	Search,
	X,
} from "lucide-react";
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
import { SIDEBAR_ITEMS } from "@/constants/sidebar";
import { cn } from "@/lib/utils";
import { SidebarActionItem, SidebarItemProps, SidebarSection } from "@/types/sidebar";
import UserActions from "./user-actions";
import OtterSidebar from "./otter-sidebar";
import ThemeToggleSwitch from "./theme-switch";
import version from "../../../../package.json";

const isActive = (pathname: string, item: SidebarActionItem, currentUrl: string) => {
	if (!item.link) return false;
	if (item.link.includes("?")) return currentUrl.startsWith(item.link);
	if (item.link === "/dashboards") return pathname.startsWith("/dashboards") || pathname.startsWith("/d/");
	if (item.link === "/dashboard") return pathname.startsWith("/dashboard") && !pathname.startsWith("/dashboards");
	return pathname.startsWith(item.link);
};

const flatItems = (items: SidebarItemProps[]) =>
	items.flatMap((item) => item.type === "section" ? item.children || [] : [item]);

const RECENT_PAGES_STORAGE_KEY = "openlit:recent-pages";
const MAX_RECENT_PAGES = 5;
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
		"flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors",
		compact && "justify-center px-2",
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
		const link = <NavigationLink item={item} active={isActive(pathname, item, currentUrl)} compact={compact} onNavigate={() => setOpenSection(null)} />;
		return compact ? <Tooltip delayDuration={100}><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right" sideOffset={8}>{item.text}</TooltipContent></Tooltip> : link;
	}

	const selected = openSection === item.title || item.children?.some((child) => isActive(pathname, child, currentUrl));
	return (
		<Tooltip delayDuration={100}>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					aria-expanded={openSection === item.title}
					onClick={() => setOpenSection(openSection === item.title ? null : item)}
					className={cn(
						"h-9 w-full justify-start gap-2.5 rounded-lg px-2.5 text-sm font-medium",
						compact && "justify-center px-2",
						selected
							? "bg-stone-200 text-stone-950 hover:bg-stone-200 dark:bg-stone-800 dark:text-white dark:hover:bg-stone-800"
							: "text-stone-600 hover:bg-stone-200/70 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white",
					)}
				>
					{compact ? <span className="text-xs font-bold">{item.title.slice(0, 1)}</span> : <><span>{item.title}</span><ChevronRight className="ml-auto size-4" /></>}
				</Button>
			</TooltipTrigger>
			{compact && <TooltipContent side="right" sideOffset={8}>{item.title}</TooltipContent>}
		</Tooltip>
	);
}

function SectionPanel({ section, pathname, currentUrl, onClose }: { section: SidebarSection; pathname: string; currentUrl: string; onClose: () => void }) {
	const children = section.children || [];

	return (
		<div
			className="absolute inset-y-0 left-full z-40 flex flex-col border-y border-r border-stone-200 bg-stone-50 shadow-xl dark:border-stone-800 dark:bg-stone-950"
			style={{ width: SECONDARY_PANEL_WIDTH }}
		>
			<div className="flex items-center justify-between border-b border-stone-200 px-3 py-2.5 dark:border-stone-800">
				<p className="text-sm font-semibold text-stone-900 dark:text-white">{section.title}</p>
				<Button variant="ghost" size="icon" onClick={onClose} aria-label="Close navigation panel" className="size-8 text-stone-700 hover:bg-stone-200 dark:text-stone-200 dark:hover:bg-stone-800"><X className="size-4" /></Button>
			</div>
			<div className="overflow-y-auto p-2">
				<div className="space-y-1">
					{children.map((item) => <NavigationLink key={item.text} item={item} active={isActive(pathname, item, currentUrl)} onNavigate={onClose} />)}
				</div>
			</div>
			{section.title === "Settings" ? <div className="flex items-center justify-between border-t border-stone-200 px-3 py-2.5 dark:border-stone-800"><span className="text-xs font-medium text-stone-600 dark:text-stone-300">Appearance</span><ThemeToggleSwitch /></div> : null}
		</div>
	);
}

export default function Sidebar() {
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [isExpanded, setIsExpanded] = useState(true);
	const [openSection, setOpenSection] = useState<SidebarSection | null>(null);
	const [commandOpen, setCommandOpen] = useState(false);
	const [recentLinks, setRecentLinks] = useState<string[]>([]);
	const currentUrl = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;
	const allItems = useMemo(() => flatItems(SIDEBAR_ITEMS), []);
	const isOtterActive = pathname.startsWith("/chat");
	const toggleSidebar = () => {
		setIsExpanded((value) => !value);
		setOpenSection(null);
	};

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
		try {
			const storedLinks = JSON.parse(window.localStorage.getItem(RECENT_PAGES_STORAGE_KEY) || "[]");
			if (Array.isArray(storedLinks)) setRecentLinks(storedLinks.filter((link): link is string => typeof link === "string"));
		} catch {
			window.localStorage.removeItem(RECENT_PAGES_STORAGE_KEY);
		}
	}, []);

	useEffect(() => {
		const visitedItem = [...allItems]
			.filter((item) => item.link && !item.target)
			.sort((a, b) => (b.link?.length || 0) - (a.link?.length || 0))
			.find((item) => isActive(pathname, item, currentUrl));
		if (!visitedItem?.link) return;
		setRecentLinks((previous) => {
			const next = [visitedItem.link!, ...previous.filter((link) => link !== visitedItem.link)].slice(0, MAX_RECENT_PAGES);
			window.localStorage.setItem(RECENT_PAGES_STORAGE_KEY, JSON.stringify(next));
			return next;
		});
	}, [allItems, currentUrl, pathname]);

	const recentItems = recentLinks.map((link) => allItems.find((item) => item.link === link)).filter((item): item is SidebarActionItem => Boolean(item));

	return (
		<aside aria-label="Main navigation" className="relative z-30 flex h-full shrink-0">
			{openSection && (
				<button
					aria-label="Close navigation panel"
					className="fixed inset-y-0 right-0 z-30 cursor-default bg-black/20 dark:bg-stone-900/40 left-0"
					onClick={() => setOpenSection(null)}
				/>
			)}
			<div data-state={isExpanded ? "open" : "closed"} className={cn("relative z-40 flex h-full flex-col border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-950", isExpanded ? "w-64" : "w-16")}>
				<Tooltip delayDuration={100}>
					<TooltipTrigger asChild>
						<Button
							variant="outline"
							size="icon"
							onClick={toggleSidebar}
							aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
							aria-expanded={isExpanded}
							className="absolute -right-3 top-5 z-50 size-6 rounded-full border-stone-300 bg-white p-0 text-stone-600 shadow-sm hover:bg-stone-100 hover:text-stone-950 focus-visible:ring-2 focus-visible:ring-primary dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white"
						>
							{isExpanded ? <ChevronsLeft className="size-3.5" /> : <ChevronsRight className="size-3.5" />}
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right" sideOffset={10}>
						{isExpanded ? "Collapse sidebar" : "Expand sidebar"}
					</TooltipContent>
				</Tooltip>
				<div className={cn("flex items-center gap-2 px-3 pb-3 pt-4", !isExpanded && "justify-center px-2")}>
					<Image className="size-9 shrink-0 object-contain" src="/images/logo.png" alt="OpenLIT logo" priority width={36} height={36} />
					<div className={cn("min-w-0 flex-1", !isExpanded && "hidden")}>
						<p className="truncate text-lg font-semibold text-stone-900 dark:text-white">OpenLIT</p>
						<p className="text-[10px] text-stone-500">v{version.version}</p>
					</div>
				</div>

				<div className="px-2 pb-3">
					<Button variant="outline" onClick={() => setCommandOpen(true)} className={cn("h-10 w-full justify-start gap-2 border-stone-300 bg-white px-3 text-stone-500 shadow-sm dark:border-stone-700 dark:bg-stone-900", !isExpanded && "justify-center px-2")} aria-label="Search navigation">
						<Search className="size-5 shrink-0" />
						<span className={cn("flex-1 text-left", !isExpanded && "hidden")}>Search data</span>
						<kbd className={cn("rounded border border-stone-200 px-1.5 py-0.5 text-[10px] dark:border-stone-700", !isExpanded && "hidden")}>⌘K</kbd>
					</Button>
				</div>

				<div className={cn("mx-2 grid rounded-xl bg-stone-100 p-1 dark:bg-stone-900", isExpanded ? "grid-cols-2" : "grid-cols-1")}>
					<Button variant="ghost" className={cn("h-9 rounded-lg text-sm", pathname.startsWith("/chat") ? "text-stone-500" : "bg-white text-stone-950 shadow-sm dark:bg-stone-800 dark:text-white")} onClick={() => { setOpenSection(null); router.push("/home"); }} aria-label="Browse">
						{isExpanded ? <span>Browse</span> : <LayoutGrid className="size-4" />}
					</Button>
					{isExpanded && <Link href="/chat" className={cn("flex items-center justify-center gap-2 rounded-lg text-sm font-medium text-stone-600 hover:text-stone-950 dark:text-stone-300 dark:hover:text-white", isOtterActive && "bg-white text-stone-950 shadow-sm dark:bg-stone-800 dark:text-white")}><MessageSquareText className="size-4 text-primary" />Otter</Link>}
				</div>

				{isOtterActive && isExpanded ? <div className="min-h-0 grow"><OtterSidebar /></div> : <nav className="flex grow flex-col gap-1 overflow-y-auto px-2 py-4" aria-label="Product navigation">
					{SIDEBAR_ITEMS.map((item) => <PrimaryItem key={item.type === "section" ? item.title : item.text} item={item} pathname={pathname} currentUrl={currentUrl} compact={!isExpanded} openSection={openSection?.title || null} setOpenSection={setOpenSection} />)}
					{isExpanded && recentItems.length > 0 && <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-800"><p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Recent</p>{recentItems.map((item) => <NavigationLink key={`recent-${item.link}`} item={item} active={isActive(pathname, item, currentUrl)} onNavigate={() => setOpenSection(null)} />)}</div>}
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
