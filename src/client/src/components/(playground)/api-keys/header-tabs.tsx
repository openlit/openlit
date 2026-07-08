"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Key, BookOpen } from "lucide-react";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import getMessage from "@/constants/messages";

interface HeaderTabsProps {
	actions?: React.ReactNode;
}

export default function ApiKeysHeader({ actions }: HeaderTabsProps) {
	const pathname = usePathname();
	const messages = getMessage();

	const tabs = [
		{
			label: messages.MANAGE_API_KEYS,
			path: "/settings/api-keys",
			icon: <Key className="h-3.5 w-3.5" />,
		},
		{
			label: messages.OPENAPI_SPECIFICATION,
			path: "/settings/api-keys/openapi",
			icon: <BookOpen className="h-3.5 w-3.5" />,
		},
	];

	return (
		<div className="flex flex-col w-full flex-shrink-0 bg-stone-50/50 dark:bg-stone-900/10">
			<FeaturePageHeader
				eyebrow={messages.SETTINGS}
				title={messages.API_KEYS}
				icon={<Key className="h-4 w-4" />}
				tone="border-primary/20 bg-primary/10 text-primary dark:border-primary/30 dark:bg-primary/15"
				actions={actions}
			/>
			<div className="flex border-b border-stone-200 dark:border-stone-800 px-4">
				{tabs.map((tab) => {
					const isActive = pathname === tab.path;
					return (
						<Link
							key={tab.path}
							href={tab.path}
							className={`flex items-center gap-2 px-4 py-3 text-xs border-b-2 font-medium transition-colors ${
								isActive
									? "border-primary text-stone-900 dark:text-stone-50 font-semibold"
									: "border-transparent text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
							}`}
						>
							{tab.icon}
							{tab.label}
						</Link>
					);
				})}
			</div>
		</div>
	);
}
