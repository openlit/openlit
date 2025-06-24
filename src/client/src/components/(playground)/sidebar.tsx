"use client";
import { ReactElement } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	BookKey,
	BookText,
	Component,
	FolderCogIcon,
	FileJson2,
	Home,
	LayoutDashboard,
	MonitorPlay,
	SettingsIcon,
	ShieldAlert,
	SquarePlay,
} from "lucide-react";
import VersionInfo from "./version-Info";

type SidebarItemProps = {
	className?: string;
	icon?: ReactElement;
	text: string;
	link?: string;
	onClick?: any;
	target?: string;
};

const ICON_CLASSES = "flex-shrink-0 size-5";

const SIDEBAR_ITEMS: SidebarItemProps[] = [
	{
		icon: <Home className={ICON_CLASSES} />,
		text: "Home",
		link: "/home",
	},
	{
		icon: <FolderCogIcon className={ICON_CLASSES} />,
		text: "Dashboards",
		link: "/dashboards",
	},
	{
		icon: <LayoutDashboard className={ICON_CLASSES} />,
		text: "Dashboard",
		link: "/dashboard",
	},
	{
		icon: <FileJson2 className={ICON_CLASSES} />,
		text: "Requests",
		link: "/requests",
	},
	{
		icon: <ShieldAlert className={ICON_CLASSES} />,
		text: "Exceptions",
		link: "/exceptions",
	},
	{
		icon: <Component className={ICON_CLASSES} />,
		text: "Prompt Hub",
		link: "/prompt-hub",
	},
	{
		icon: <BookKey className={ICON_CLASSES} />,
		text: "Vault",
		link: "/vault",
	},
	{
		icon: <MonitorPlay className={ICON_CLASSES} />,
		text: "Openground",
		link: "/openground",
	},
	{
		icon: <SettingsIcon className={ICON_CLASSES} />,
		text: "Settings",
		link: "/settings",
	},
];

const SIDEBAR_BOTTOM_ITEMS: SidebarItemProps[] = [
	{
		icon: <SquarePlay className={ICON_CLASSES} />,
		text: "Getting started",
		link: "/getting-started",
	},
	{
		text: "Documentation",
		link: "https://docs.openlit.io/",
		target: "_blank",
		icon: <BookText className={ICON_CLASSES} />,
	},
];

const getIfSidebarItemActive = (pathname: string, item: SidebarItemProps) => {
	switch (item.link) {
		case "/home":
			return pathname.startsWith("/home");
		case "/dashboards":
			return pathname.startsWith("/dashboards") || pathname.startsWith("/d/");
		case "/dashboard":
			return pathname.startsWith("/dashboard") && !pathname.startsWith("/dashboards");
		case "/requests":
			return pathname.startsWith("/requests");
		case "/exceptions":
			return pathname.startsWith("/exceptions");
		case "/prompt-hub":
			return pathname.startsWith("/prompt-hub");
		case "/vault":
			return pathname.startsWith("/vault");
		case "/openground":
			return pathname.startsWith("/openground");
		case "/settings":
			return pathname.startsWith("/settings");
		default:
			return pathname.startsWith(item.link || "");
	}
};

const SidebarItem = (props: SidebarItemProps) => {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{!props.target && props.link ? (
					<Link
						className={`${buttonVariants({
							variant: "ghost",
							size: "icon",
						})} ${props.className || ""}`}
						href={props.link}
						aria-label={props.text}
					>
						{props.icon}
					</Link>
				) : (
					<a
						href={props.link}
						className={`flex items-center p-2 ${buttonVariants({
							variant: "ghost",
							size: "icon",
						})} ${
							props.className || ""
						}`}
						onClick={props.onClick}
						target={props.target}
					>
						{props.icon}
					</a>
				)}
			</TooltipTrigger>
			<TooltipContent side="right" sideOffset={5}>
				{props.text}
			</TooltipContent>
		</Tooltip>
	);
};

export default function Sidebar() {
	const pathname = usePathname();

	return (
		<aside
			aria-label="Sidebar"
			className="inset-y fixed left-0 z-30 flex h-full flex-col border-r dark:border-stone-800"
		>
			<div className="flex border-b dark:border-stone-800 p-2">
				<Button variant="ghost" size="icon" aria-label="Home">
					<Image
						className="size-10 flex-shrink-0 transition duration-75 p-1"
						src="/images/logo.png"
						alt="openlit's Logo"
						priority
						width={24}
						height={24}
					/>
				</Button>
			</div>
			<nav className="grid gap-1 p-2 pt-4">
				{SIDEBAR_ITEMS.map((item, index) => (
					<SidebarItem
						key={`sidebar-top-${index}`}
						className={`${
							getIfSidebarItemActive(pathname, item)
								? "text-white bg-primary dark:bg-primary dark:text-white hover:bg-primary/80 dark:hover:bg-primary/80 hover:text-white"
								: "text-stone-600 dark:text-white hover:bg-stone-700 dark:hover:bg-stone-600 hover:text-white"
						}`}
						{...item}
					/>
				))}
			</nav>
			<nav className="mt-auto grid gap-1 p-2">
				{SIDEBAR_BOTTOM_ITEMS.map((item, index) => (
					<SidebarItem
						key={`sidebar-bottom-${index}`}
						className={`${
							getIfSidebarItemActive(pathname, item)
								? "text-white bg-primary dark:bg-primary dark:text-white hover:bg-primary/80 dark:hover:bg-primary/80 hover:text-white"
								: "text-stone-600 dark:text-white hover:bg-stone-700 dark:hover:bg-stone-600 hover:text-white"
						}`}
						{...item}
					/>
				))}
				<VersionInfo />
			</nav>
		</aside>
	);
}
