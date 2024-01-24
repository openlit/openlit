"use client";

import { signOut } from "next-auth/react";
import { ReactElement, useState } from "react";
import {
	ArrowLeftEndOnRectangleIcon,
	Bars3CenterLeftIcon,
	HomeModernIcon,
} from "@heroicons/react/24/solid";
import Image from "next/image";

type SidebarItem = {
	icon: ReactElement;
	text: string;
	link?: string;
	onClick?: any;
};

const SidebarItem = (props: SidebarItem) => {
	return (
		<a
			href={props.link}
			className="flex items-center p-2 text-base text-gray-900 rounded-lg hover:bg-gray-100 group dark:text-gray-200 dark:hover:bg-gray-700 cursor-pointer"
			onClick={props.onClick}
		>
			{props.icon}
			<span className="ml-5 text-nowrap">{props.text}</span>
		</a>
	);
};

export default function PlaygroundSidebar() {
	const [collapsed, setIsCollapsed] = useState<boolean>(false);
	const onCollapseClick = () => {
		setIsCollapsed((e) => !e);
	};

	return (
		<aside
			className={`flex flex-col flex-shrink-0 ${
				collapsed ? "w-16" : "w-64"
			} overflow-hidden h-full font-normal duration-75 lg:flex transition-width`}
			aria-label="Sidebar"
		>
			<div className="relative flex flex-col flex-1 min-h-0 pt-0 bg-transparent dark:border-gray-700">
				<div className="flex flex-col flex-1 pt-5 pb-4 overflow-y-auto dark:divide-gray-700">
					<div className="flex shrink-0 px-3 bg-transparent pb-4">
						<SidebarItem
							link="/"
							icon={
								<Image
									className="flex-shrink-0 w-6 h-6 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
									src="https://avatars.githubusercontent.com/u/149867240?s=48&v=4"
									alt="Doku's Logo"
									priority
									width={24}
									height={24}
								/>
							}
							text="Doku"
						/>
					</div>
					<div className="flex-1 px-3 space-y-1 bg-transparent">
						<ul className="pb-2 pt-2 space-y-2">
							<li>
								<SidebarItem
									icon={
										<HomeModernIcon className="flex-shrink-0 w-6 h-6 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white" />
									}
									text="Dashboard"
									link="/dashboard"
								/>
							</li>
						</ul>
						<div className="pt-2 space-y-2">
							<SidebarItem
								icon={
									<ArrowLeftEndOnRectangleIcon className="flex-shrink-0 w-6 h-6 text-gray-500 transition duration-75 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white" />
								}
								text="Signout"
								onClick={signOut}
							/>
						</div>
					</div>
				</div>
				<div className="justify-center w-full p-4 space-x-4 lg:flex bg-transparent">
					<a
						onClick={onCollapseClick}
						className="inline-flex justify-center p-2 text-gray-500 rounded cursor-pointer hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-white"
					>
						<Bars3CenterLeftIcon className="w-6 h-6" />
					</a>
				</div>
			</div>
		</aside>
	);
}
