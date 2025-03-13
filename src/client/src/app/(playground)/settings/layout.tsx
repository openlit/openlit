"use client";
import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type React from "react";

export default function SettingsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const router = useRouter();
	const pathname = usePathname();

	const tabs = [
		{
			value: "evaluation",
			label: "Evaluation Settings",
			path: "/settings/evaluation",
		},
		{ value: "profile", label: "User Profile", path: "/settings/profile" },
		{
			value: "database",
			label: "Database Config",
			path: "/settings/database-config",
		},
		{ value: "api-keys", label: "API Keys", path: "/settings/api-keys" },
	];

	const currentTab =
		tabs.find((tab) => pathname.startsWith(tab.path))?.value || "profile";

	const handleTabChange = (value: string) => {
		const tab = tabs.find((t) => t.value === value);
		if (tab) {
			router.push(tab.path);
		}
	};

	return (
		<Tabs
			value={currentTab}
			onValueChange={handleTabChange}
			className="w-full flex flex-col h-full"
		>
			<TabsList className="grid grid-cols-4 mb-4 self-start">
				{tabs.map((tab) => (
					<TabsTrigger key={tab.value} value={tab.value}>
						{tab.label}
					</TabsTrigger>
				))}
			</TabsList>
			<div className="flex w-full border dark:border-stone-800 grow overflow-hidden">
				{children}
			</div>
		</Tabs>
	);
}
