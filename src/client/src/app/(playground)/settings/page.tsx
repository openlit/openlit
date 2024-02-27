"use client";

import { Tab } from "@headlessui/react";
import { useSearchParams } from "next/navigation";
import { ReactNode } from "react";
import Database from "./database";

type TabsObjectType = Record<
	"database",
	{
		title: string;
		component: ReactNode;
	}
>;

type KeyofTabsObjectType = keyof TabsObjectType;

const tabsObject: TabsObjectType = {
	database: {
		title: "Database",
		component: <Database />,
	},
};

export default function Settings() {
	const tabs = Object.keys(tabsObject) as Array<KeyofTabsObjectType>;
	const search = useSearchParams();
	const selectedTabIndex = tabs.indexOf(
		(search.get("tab") || "") as KeyofTabsObjectType
	);

	return (
		<div className="flex flex-col w-full flex-1 overflow-auto relative">
			<Tab.Group defaultIndex={selectedTabIndex}>
				<Tab.List className="flex space-x-1 bg-white sticky top-0 z-20">
					{tabs.map((item) => (
						<Tab
							key={item}
							className={({ selected }) =>
								`w-auto py-2 px-3 text-sm font-medium leading-5 outline-none border-b-2 ${
									selected
										? "text-primary border-primary"
										: "text-tertiary/[0.3] border-white"
								}`
							}
						>
							{tabsObject[item].title}
						</Tab>
					))}
				</Tab.List>
				<Tab.Panels className="flex flex-1 overflow-hidden w-full">
					{tabs.map((item) => (
						<Tab.Panel
							key={item}
							className={`flex-1 rounded-xl bg-white outline-none relative`}
						>
							{tabsObject[item].component}
						</Tab.Panel>
					))}
				</Tab.Panels>
			</Tab.Group>
		</div>
	);
}
