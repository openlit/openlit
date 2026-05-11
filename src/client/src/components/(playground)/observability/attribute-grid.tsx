"use client";

import { isPlainObject } from "lodash";

export default function AttributeGrid({
	data,
	title,
}: {
	data?: Record<string, any>;
	title: string;
}) {
	const entries = Object.entries(data || {}).filter(([, value]) => value !== "");
	return (
		<section className="rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900">
			<div className="border-b border-stone-200 dark:border-stone-800 px-3 py-2 text-sm font-medium text-stone-900 dark:text-stone-100">
				{title}
			</div>
			{entries.length ? (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-stone-200 dark:bg-stone-800">
					{entries.map(([key, value]) => (
						<div
							key={key}
							className="min-w-0 bg-white dark:bg-stone-950 px-3 py-2"
						>
							<div className="text-xs text-stone-500 dark:text-stone-400 truncate">
								{key}
							</div>
							<pre className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-800 dark:text-stone-200 font-mono">
								{isPlainObject(value)
									? JSON.stringify(value, null, 2)
									: String(value)}
							</pre>
						</div>
					))}
				</div>
			) : (
				<div className="px-3 py-6 text-sm text-stone-400">No attributes.</div>
			)}
		</section>
	);
}
