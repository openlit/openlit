"use client";

import type { ReactNode } from "react";
import { isPlainObject } from "lodash";
import AttributeGrid from "./attribute-grid";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

export default function DetailObjectTabs({
	tabs,
	extraTabs,
	extraTabsPlacement = "after",
}: {
	tabs: DetailObjectTab[];
	extraTabs?: Array<{
		id: string;
		label: string;
		content: ReactNode;
	}>;
	extraTabsPlacement?: "before" | "after";
}) {
	const objectTabs = tabs.map((tab) => ({ ...tab, type: "object" as const }));
	const customTabs = (extraTabs || []).map((tab) => ({
		...tab,
		type: "custom" as const,
	}));
	const allTabs =
		extraTabsPlacement === "before"
			? [...customTabs, ...objectTabs]
			: [...objectTabs, ...customTabs];
	if (!allTabs.length) return null;

	return (
		<Tabs defaultValue={allTabs[0].id} className="min-w-0">
			<div className="max-w-full overflow-x-auto overflow-y-hidden pb-1">
				<TabsList className="h-9 w-max min-w-full justify-start rounded-md bg-stone-100 p-1 dark:bg-stone-900">
					{allTabs.map((tab) => (
						<TabsTrigger
							key={tab.id}
							value={tab.id}
							className="shrink-0 px-3 py-1 text-xs"
						>
							{tab.label}
						</TabsTrigger>
					))}
				</TabsList>
			</div>
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
