"use client";

import { useMemo, useState, type ReactNode } from "react";
import { isPlainObject } from "lodash";
import { ClipboardCheck, Sparkles } from "lucide-react";
import AttributeGrid from "./attribute-grid";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import getMessage from "@/constants/messages";

type DetailObjectTab = {
	id: string;
	label: string;
	data: unknown;
};

function humanizeKey(key: string) {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

function isRenderableValue(value: unknown) {
	if (Array.isArray(value)) return value.length > 0;
	return isPlainObject(value) && Object.keys(value as Record<string, any>).length > 0;
}

function isEmptyValue(value: unknown) {
	if (Array.isArray(value)) return value.length === 0;
	if (isPlainObject(value)) return Object.keys(value as Record<string, any>).length === 0;
	return value === "" || value === null || value === undefined;
}

function buildDottedArrayTabs(
	source: Record<string, any>,
	exclude: Set<string>,
	labelOverrides?: Record<string, string>
) {
	const groups = new Map<string, Record<string, unknown[]>>();

	Object.entries(source).forEach(([key, value]) => {
		if (exclude.has(key) || !Array.isArray(value) || !key.includes(".")) return;
		const [group, ...fieldParts] = key.split(".");
		const field = fieldParts.join(".");
		if (!group || !field) return;
		if (!groups.has(group)) groups.set(group, {});
		groups.get(group)![field] = value;
	});

	const groupedKeys = new Set<string>();
	const tabs: DetailObjectTab[] = [];

	groups.forEach((fields, group) => {
		const maxRows = Math.max(...Object.values(fields).map((values) => values.length));
		const rows = Array.from({ length: maxRows }, (_, index) => {
			const row: Record<string, unknown> = {};
			Object.entries(fields).forEach(([field, values]) => {
				const value = values[index];
				if (!isEmptyValue(value)) row[field] = value;
			});
			return row;
		}).filter((row) => Object.keys(row).length > 0);

		if (!rows.length) return;
		Object.keys(fields).forEach((field) => groupedKeys.add(`${group}.${field}`));
		tabs.push({
			id: group,
			label: labelOverrides?.[group] || humanizeKey(group),
			data: rows,
		});
	});

	return { tabs, groupedKeys };
}

function buildRootProperties(
	source: Record<string, any>,
	exclude: Set<string>,
	groupedKeys: Set<string>
) {
	return Object.fromEntries(
		Object.entries(source).filter(
			([key, value]) =>
				!exclude.has(key) &&
				!groupedKeys.has(key) &&
				!isEmptyValue(value) &&
				!Array.isArray(value) &&
				!isPlainObject(value)
		)
	);
}

export function buildObjectTabs(
	source?: Record<string, any>,
	options: {
		excludeKeys?: string[];
		labelOverrides?: Record<string, string>;
		rootLabel?: string;
	} = {}
): DetailObjectTab[] {
	const exclude = new Set(options.excludeKeys || []);
	const sourceObject = source || {};
	const { tabs: groupedTabs, groupedKeys } = buildDottedArrayTabs(
		sourceObject,
		exclude,
		options.labelOverrides
	);
	const directTabs = Object.entries(sourceObject)
		.filter(
			([key, value]) =>
				!exclude.has(key) && !groupedKeys.has(key) && isRenderableValue(value)
		)
		.map(([key, value]) => ({
			id: key,
			label: options.labelOverrides?.[key] || humanizeKey(key),
			data: value,
		}));
	const rootProperties = buildRootProperties(sourceObject, exclude, groupedKeys);
	const rootTab = Object.keys(rootProperties).length
		? [
				{
					id: "root",
					label: options.rootLabel || "Overview",
					data: rootProperties,
				},
		  ]
		: [];

	return [...rootTab, ...directTabs, ...groupedTabs];
}

function featuredIcon(tabId: string) {
	if (tabId === "evaluations") return <ClipboardCheck className="h-3.5 w-3.5" />;
	return <Sparkles className="h-3.5 w-3.5" />;
}

type CustomTab = {
	id: string;
	label: string;
	content: ReactNode;
};

export default function DetailObjectTabs({
	tabs,
	extraTabs,
}: {
	tabs: DetailObjectTab[];
	extraTabs?: CustomTab[];
	extraTabsPlacement?: "before" | "after";
}) {
	const m = getMessage();
	const objectTabs = tabs.map((tab) => ({ ...tab, type: "object" as const }));
	const featuredTabs = (extraTabs || []).map((tab) => ({
		...tab,
		type: "custom" as const,
	}));
	const detailTabs = objectTabs;
	const allTabs = [...featuredTabs, ...detailTabs];
	const defaultTab = detailTabs[0]?.id || featuredTabs[0]?.id;
	const [activeTab, setActiveTab] = useState(defaultTab);
	const resolvedTab = useMemo(() => {
		if (allTabs.some((tab) => tab.id === activeTab)) return activeTab;
		return defaultTab;
	}, [activeTab, allTabs, defaultTab]);

	if (!allTabs.length || !resolvedTab) return null;

	return (
		<Tabs
			value={resolvedTab}
			onValueChange={setActiveTab}
			className="min-w-0"
		>
			{featuredTabs.length > 0 && (
				<div className="mb-2 flex flex-wrap gap-1.5">
					{featuredTabs.map((tab) => {
						const selected = resolvedTab === tab.id;
						return (
							<button
								key={tab.id}
								type="button"
								onClick={() => setActiveTab(tab.id)}
								aria-pressed={selected}
								className={cn(
									"inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
									selected
										? "bg-primary text-white"
										: "border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200 dark:hover:bg-stone-900"
								)}
							>
								{featuredIcon(tab.id)}
								{tab.label}
							</button>
						);
					})}
				</div>
			)}
			{detailTabs.length > 0 && (
				<div className="max-w-full overflow-x-auto overflow-y-hidden">
					<TabsList
						aria-label={m.OBSERVABILITY_SPAN_DETAILS}
						className="h-8 w-max min-w-full justify-start gap-0 rounded-none border-b border-stone-200 bg-transparent p-0 dark:border-stone-800"
					>
						{detailTabs.map((tab) => (
							<TabsTrigger
								key={tab.id}
								value={tab.id}
								className="h-8 shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-2.5 text-xs shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-stone-900 data-[state=active]:shadow-none dark:data-[state=active]:text-stone-50"
							>
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>
				</div>
			)}
			{allTabs.map((tab) => (
				<TabsContent key={tab.id} value={tab.id} className="mt-3">
					{tab.type === "object" ? (
						<AttributeGrid title={tab.label} data={tab.data} />
					) : (
						tab.content
					)}
				</TabsContent>
			))}
		</Tabs>
	);
}
