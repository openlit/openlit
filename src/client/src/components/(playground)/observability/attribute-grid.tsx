"use client";

import { useMemo, useState } from "react";
import { isPlainObject } from "lodash";

function isEmptyValue(value: unknown) {
	return value === "" || value === null || value === undefined;
}

function stringifyValue(value: unknown) {
	if (isEmptyValue(value)) return "-";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function shouldClamp(value: unknown, text: string) {
	return Array.isArray(value) || isPlainObject(value) || text.length > 180 || text.split("\n").length > 3;
}

function ValueCell({ value }: { value: unknown }) {
	const [expanded, setExpanded] = useState(false);
	const text = useMemo(() => stringifyValue(value), [value]);
	const clamp = shouldClamp(value, text);
	const isStructured = Array.isArray(value) || isPlainObject(value);
	const className = isStructured
		? `max-w-full overflow-auto whitespace-pre-wrap break-words rounded border border-stone-200 bg-stone-50 p-2 font-mono text-xs leading-5 text-stone-800 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200 ${
				expanded ? "max-h-96" : "max-h-[3.75rem]"
		  }`
		: `max-w-full whitespace-pre-wrap break-words font-mono text-xs leading-5 text-stone-800 dark:text-stone-200 ${
				!expanded && clamp ? "line-clamp-3 overflow-hidden" : ""
		  }`;

	return (
		<div className="min-w-0 max-w-full">
			<pre className={className}>{text}</pre>
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

function renderValue(value: unknown) {
	return <ValueCell value={value} />;
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
					{renderValue(value)}
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
