"use client";

import { ReactElement } from "react";
import {
	AcademicCapIcon,
	ArrowTopRightOnSquareIcon,
	CircleStackIcon,
	HomeModernIcon,
	KeyIcon,
} from "@heroicons/react/24/solid";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LinkIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";

type SidebarItemProps = {
	className?: string;
	leftIcon?: ReactElement;
	text: string;
	link?: string;
	onClick?: any;
	target?: string;
	rightIcon?: ReactElement;
};

const ICON_CLASSES =
	"flex-shrink-0 w-6 h-6 transition duration-75 transition duration-75";

const SIDEBAR_ITEMS: SidebarItemProps[] = [
	{
		leftIcon: <AcademicCapIcon className={ICON_CLASSES} />,
		text: "Getting started",
		link: "/getting-started",
	},
	{
		leftIcon: <HomeModernIcon className={ICON_CLASSES} />,
		text: "Dashboard",
		link: "/dashboard",
	},
	{
		leftIcon: <CircleStackIcon className={ICON_CLASSES} />,
		text: "Requests",
		link: "/requests",
	},
	{
		leftIcon: <KeyIcon className={ICON_CLASSES} />,
		text: "API keys",
		link: "/api-keys",
	},
	{
		leftIcon: <LinkIcon className={ICON_CLASSES} />,
		text: "Connections",
		link: "/connections",
	},
	{
		leftIcon: <WrenchScrewdriverIcon className={ICON_CLASSES} />,
		text: "Settings",
		link: "/settings",
	},
];

const SIDEBAR_BOTTOM_ITEMS: SidebarItemProps[] = [
	{
		text: "Documentation",
		link: "https://docs.dokulabs.com/",
		target: "_blank",
		className: "justify-center text-sm text-primary hover:bg-primary/[0.1]",
		rightIcon: (
			<ArrowTopRightOnSquareIcon
				className={
					"flex-shrink-0 w-3 h-3 transition duration-75 transition duration-75 ml-3"
				}
			/>
		),
	},
];

const SidebarItem = (props: SidebarItemProps) => {
	return (
		<a
			href={props.link}
			className={`flex items-center p-2 cursor-pointer ${
				props.className || ""
			}`}
			onClick={props.onClick}
			target={props.target}
		>
			{props.leftIcon}
			<span className={`${props.leftIcon && "ml-5"} text-nowrap`}>
				{props.text}
			</span>
			{props.rightIcon}
		</a>
	);
};

export default function Sidebar() {
	const pathname = usePathname();

	return (
		<aside
			className={`flex flex-col flex-shrink-0 w-48 h-full font-normal duration-75 transition-width`}
			aria-label="Sidebar"
		>
			<div className="relative flex flex-col flex-1 min-h-0 gap-2">
				<div className="flex shrink-0 pt-2 relative items-center">
					<SidebarItem
						className="w-full text-tertiary font-bold text-2xl"
						link="/"
						leftIcon={
							<Image
								className="flex-shrink-0 w-10 h-10 transition duration-75"
								src="/images/logo.png"
								alt="Doku's Logo"
								priority
								width={24}
								height={24}
							/>
						}
						text="Doku"
					/>
				</div>
				<div className="w-full margin-y-2" />
				<ul className="flex-1 pt-2 text-sm">
					{SIDEBAR_ITEMS.map((item, index) => (
						<li key={`sidebar-${index}`}>
							<SidebarItem
								className={
									item.link === pathname
										? "border-r-4 border-primary text-primary bg-primary/[.09]"
										: "text-tertiary/[0.8] hover:text-primary"
								}
								{...item}
							/>
						</li>
					))}
				</ul>
				<ul className="shrink-0 bg-secondary/[0.9]">
					{SIDEBAR_BOTTOM_ITEMS.map((item, index) => (
						<li key={`sidebar-${index}`}>
							<SidebarItem
								className={
									item.link === pathname
										? "border-r-4 border-primary text-primary bg-primary/[.09]"
										: "text-tertiary/[0.5] justify-center text-sm"
								}
								{...item}
							/>
						</li>
					))}
				</ul>
			</div>
		</aside>
	);
}
