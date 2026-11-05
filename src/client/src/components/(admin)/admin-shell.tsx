"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { ArrowLeft, LogOut, ShieldCheck } from "lucide-react";
import SidebarBrand from "@/components/(playground)/sidebar-brand";
import {
	SidebarLayoutProvider,
	playgroundTopBarClassName,
	useSidebarLayout,
} from "@/components/(playground)/sidebar-layout-context";
import { HeaderScopeSeparator } from "@/components/(playground)/header-scope-pill";
import ThemeToggleSwitch from "@/components/(playground)/sidebar/theme-switch";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import getMessage from "@/constants/messages";
import { DEFAULT_LOGGED_IN_ROUTE } from "@/constants/route";
import { ICON_CLASSES } from "@/constants/sidebar";
import { getAdminSidebarItems } from "@/features/admin-sidebar";
import { cn } from "@/lib/utils";

const NAV_LINK_CLASS =
	"flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-stone-300 dark:focus-visible:ring-offset-stone-950";
const NAV_LINK_ACTIVE_CLASS = "bg-stone-200 text-stone-950 dark:bg-stone-800 dark:text-white";
const NAV_LINK_IDLE_CLASS =
	"text-stone-600 hover:bg-stone-200/70 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white";

function AdminNavLink({
	href,
	icon,
	text,
	active,
	compact,
}: {
	href: string;
	icon?: ReactNode;
	text: string;
	active: boolean;
	compact: boolean;
}) {
	const link = (
		<Link
			href={href}
			aria-current={active ? "page" : undefined}
			className={cn(
				NAV_LINK_CLASS,
				compact && "justify-center px-2",
				active ? NAV_LINK_ACTIVE_CLASS : NAV_LINK_IDLE_CLASS
			)}
		>
			{icon}
			<span className={cn("min-w-0 truncate", compact && "sr-only")}>{text}</span>
		</Link>
	);
	if (!compact) return link;
	return (
		<Tooltip delayDuration={100}>
			<TooltipTrigger asChild>{link}</TooltipTrigger>
			<TooltipContent side="right" sideOffset={8}>
				{text}
			</TooltipContent>
		</Tooltip>
	);
}

function AdminSidebar({ adminEmail }: { adminEmail: string }) {
	const messages = getMessage();
	const pathname = usePathname() || "";
	const { isExpanded } = useSidebarLayout();
	const compact = !isExpanded;
	const items = getAdminSidebarItems(ICON_CLASSES).filter((item) => item.link);

	return (
		<aside
			aria-label={messages.INSTANCE_ADMIN_NAVIGATION}
			className="flex h-full min-h-0 w-full flex-col bg-stone-50 dark:bg-stone-950"
		>
			<nav
				aria-label={messages.INSTANCE_ADMIN_NAVIGATION}
				className="scrollbar-hidden flex grow flex-col gap-1 overflow-y-auto px-2 py-3"
			>
				{!compact ? (
					<p className="px-2.5 pb-1 text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400">
						{messages.INSTANCE_ADMIN_NAVIGATION}
					</p>
				) : null}
				{items.map((item) => (
					<AdminNavLink
						key={item.link}
						href={item.link!}
						icon={item.icon}
						text={item.text}
						active={pathname === item.link || pathname.startsWith(`${item.link}/`)}
						compact={compact}
					/>
				))}
			</nav>
			<div className="flex flex-col gap-1 border-t border-stone-200 p-2 dark:border-stone-800">
				<AdminNavLink
					href={DEFAULT_LOGGED_IN_ROUTE}
					icon={<ArrowLeft className={ICON_CLASSES} />}
					text={messages.INSTANCE_ADMIN_BACK_TO_APP}
					active={false}
					compact={compact}
				/>
				{!compact ? (
					<div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
						<div className="grid min-w-0 text-left leading-tight">
							<span className="text-[11px] text-stone-500 dark:text-stone-400">
								{messages.INSTANCE_ADMIN_SIGNED_IN_AS}
							</span>
							<span className="truncate text-xs font-medium text-stone-700 dark:text-stone-200">
								{adminEmail}
							</span>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={messages.LOG_OUT}
							title={messages.LOG_OUT}
							onClick={() => signOut({ callbackUrl: "/login" })}
							className="size-8 shrink-0 text-stone-600 hover:bg-stone-200 dark:text-stone-300 dark:hover:bg-stone-800"
						>
							<LogOut className="size-4" />
						</Button>
					</div>
				) : null}
			</div>
		</aside>
	);
}

function AdminShellFrame({
	adminEmail,
	children,
}: {
	adminEmail: string;
	children: ReactNode;
}) {
	const messages = getMessage();
	const { sidebarWidthClass } = useSidebarLayout();

	return (
		<div className="flex h-screen w-full flex-col overflow-hidden border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-950">
			<div className="flex shrink-0 border-b border-stone-200 dark:border-stone-800">
				<div
					className={cn(
						"relative shrink-0 border-r border-stone-200 dark:border-stone-800",
						sidebarWidthClass
					)}
				>
					<SidebarBrand />
				</div>
				<header
					className={playgroundTopBarClassName("min-w-0 flex-1 gap-3 pl-6 pr-3")}
				>
					<div className="flex min-w-0 items-center gap-2 text-stone-950 dark:text-white">
						<ShieldCheck className="size-4 shrink-0 text-stone-500 dark:text-stone-400" />
						<span className="truncate text-[13px] font-semibold">
							{messages.INSTANCE_ADMIN_TITLE}
						</span>
					</div>
					<HeaderScopeSeparator />
					<span className="truncate text-xs text-stone-500 dark:text-stone-400">
						{adminEmail}
					</span>
					<div className="ml-auto flex items-center gap-2">
						<ThemeToggleSwitch />
					</div>
				</header>
			</div>
			<div className="flex min-h-0 flex-1">
				<div
					className={cn(
						"relative z-30 flex shrink-0 flex-col border-r border-stone-200 dark:border-stone-800",
						sidebarWidthClass
					)}
				>
					<AdminSidebar adminEmail={adminEmail} />
				</div>
				<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					{children}
				</main>
			</div>
		</div>
	);
}

export default function AdminShell({
	adminEmail,
	children,
}: {
	adminEmail: string;
	children: ReactNode;
}) {
	return (
		<SidebarLayoutProvider>
			<AdminShellFrame adminEmail={adminEmail}>{children}</AdminShellFrame>
		</SidebarLayoutProvider>
	);
}
