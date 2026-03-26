"use client";
import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type React from "react";
import { PRIMARY_BACKGROUND } from "@/constants/common-classes";
import { Settings, Layers } from "lucide-react";

export default function EvaluationsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const router = useRouter();
	const pathname = usePathname();

	const tabs = [
		{
			value: "settings",
			label: "Settings",
			path: "/evaluations/settings",
			icon: Settings,
		},
		{
			value: "types",
			label: "Evaluation Types",
			path: "/evaluations/types",
			icon: Layers,
		},
	];

	const currentTab =
		tabs.find((tab) => pathname.startsWith(tab.path))?.value || "settings";

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
			<div className="flex items-center justify-between gap-4 mb-4">
				<TabsList className="p-0 h-[30px] grid grid-cols-2 self-start border border-stone-200 dark:border-stone-800">
					{tabs.map((tab) => (
						<TabsTrigger
							key={tab.value}
							value={tab.value}
							className="py-1.5 text-xs rounded-md flex items-center gap-1.5"
						>
							<tab.icon className="size-3.5" />
							{tab.label}
						</TabsTrigger>
					))}
				</TabsList>
			</div>
			<div
				className={`flex w-full border border-stone-200 dark:border-stone-800 ${PRIMARY_BACKGROUND} rounded-lg grow overflow-hidden`}
			>
				{children}
			</div>
		</Tabs>
	);
}
