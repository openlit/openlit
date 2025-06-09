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
	FileJson2,
	LayoutDashboard,
	MonitorPlay,
	SettingsIcon,
	ShieldAlert,
	SquarePlay,
} from "lucide-react";
import VersionInfo from "./version-Info";
import { useDemoAccount } from "@/contexts/demo-account-context";

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

const SidebarItem = (props: SidebarItemProps) => {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{!props.target && props.link ? (
					<Link
						className={`${props.className || ""} ${buttonVariants({
							variant: "ghost",
							size: "icon",
						})}`}
						href={props.link}
						aria-label={props.text}
					>
						{props.icon}
					</Link>
				) : (
					<a
						href={props.link}
						className={`flex items-center p-2 ${props.className || ""
							} ${buttonVariants({
								variant: "ghost",
								size: "icon",
							})}`}
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
	const { isDemoAccount } = useDemoAccount();

	console.log("[Sidebar Debug] isDemoAccount:", isDemoAccount);

	const filteredSidebarItems = SIDEBAR_ITEMS.filter(item =>
		!isDemoAccount || item.text !== "Settings"
	);

	console.log("[Sidebar Debug] filteredSidebarItems:", filteredSidebarItems.map(i => i.text));

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
				{filteredSidebarItems.map((item, index) => (
					<SidebarItem
						key={`sidebar-top-${index}`}
						className={`${pathname.startsWith(item.link || "")
								? "text-white bg-primary dark:bg-primary dark:text-white"
								: "text-stone-600 dark:text-white"
							}`}
						{...item}
					/>
				))}
			</nav>
			<nav className="mt-auto grid gap-1 p-2">
				{SIDEBAR_BOTTOM_ITEMS.map((item, index) => (
					<SidebarItem
						key={`sidebar-bottom-${index}`}
						className={`${pathname.startsWith(item.link || "")
								? "text-white bg-primary dark:bg-primary dark:text-white"
								: "text-stone-600 dark:text-white"
							}`}
						{...item}
					/>
				))}
				<VersionInfo />
			</nav>
		</aside>
	);
}
