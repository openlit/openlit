"use client";

import { useMemo, useState } from "react";
import { isPlainObject } from "lodash";
import StructuredValue from "@/components/common/structured-value";
import {
	SPAN_CONTENT_KEYS,
	isEmptyValue,
	stringifyValue,
} from "@/helpers/client/span-messages";

function shouldClamp(value: unknown, text: string) {
	return Array.isArray(value) || isPlainObject(value) || text.length > 180 || text.split("\n").length > 3;
}

function ValueCell({
	attributeKey,
	value,
}: {
	attributeKey: string;
	value: unknown;
}) {
	const [expanded, setExpanded] = useState(false);
	const text = useMemo(() => stringifyValue(value), [value]);
	const clamp = shouldClamp(value, text);
	const clampClassName = expanded
		? "max-h-96 overflow-auto"
		: "max-h-[3.75rem] overflow-hidden";

	return (
		<div className="min-w-0 max-w-full">
			<StructuredValue
				value={value}
				markdown={SPAN_CONTENT_KEYS.has(attributeKey)}
				bodyClassName={clamp ? clampClassName : undefined}
			/>
			{clamp && (
				<button
					type="button"
					className="mt-1 text-xs font-medium text-primary hover:underline"
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</div>
	);
}

function renderValue(key: string, value: unknown) {
	return <ValueCell attributeKey={key} value={value} />;
}

function getObjectEntries(data: unknown) {
	if (!isPlainObject(data)) return [];
	return Object.entries(data as Record<string, unknown>).filter(
		([, value]) => !isEmptyValue(value)
	);
}

function KeyValueRows({ entries }: { entries: Array<[string, unknown]> }) {
	return (
		<div className="divide-y divide-stone-200 dark:divide-stone-800">
			{entries.map(([key, value], index) => (
				<div
					key={key}
					className={`grid min-w-0 grid-cols-1 gap-2 px-3 py-2 md:grid-cols-[minmax(180px,32%)_minmax(0,1fr)] ${
						index % 2 === 0
							? "bg-white dark:bg-stone-950"
							: "bg-stone-50 dark:bg-stone-900/70"
					}`}
				>
					<div className="truncate font-mono text-xs font-medium text-stone-600 dark:text-stone-300">
						{key}
					</div>
					{renderValue(key, value)}
				</div>
			))}
		</div>
	);
}

function ArrayGroups({ rows }: { rows: unknown[] }) {
	if (!rows.length) {
		return <div className="px-3 py-6 text-sm text-stone-400">No data.</div>;
	}

	return (
		<div className="space-y-3 p-3">
			{rows.map((row, index) => {
				const entries = isPlainObject(row)
					? getObjectEntries(row)
					: [[`#${index + 1}`, row] as [string, unknown]];
				return (
					<div
						key={index}
						className="overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"
					>
						<div className="border-b border-stone-200 bg-stone-100 px-3 py-2 font-mono text-xs font-semibold text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
							#{index + 1}
						</div>
						{entries.length ? (
							<KeyValueRows entries={entries} />
						) : (
							<div className="px-3 py-4 text-sm text-stone-400">No data.</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

export default function AttributeGrid({
	data,
	title,
}: {
	data?: unknown;
	title: string;
}) {
	const entries = getObjectEntries(data);
	return (
		<section className="rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900">
			<div className="border-b border-stone-200 dark:border-stone-800 px-3 py-2 text-sm font-medium text-stone-900 dark:text-stone-100">
				{title}
			</div>
			{Array.isArray(data) ? (
				<ArrayGroups rows={data} />
			) : entries.length ? (
				<KeyValueRows entries={entries} />
			) : (
				<div className="px-3 py-6 text-sm text-stone-400">No attributes.</div>
			)}
		</section>
	);
}
