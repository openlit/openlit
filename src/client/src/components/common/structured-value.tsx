"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Markdown from "@/components/common/markdown";
import getMessage from "@/constants/messages";
import {
	parseStructuredValue,
	stringifyValue,
} from "@/helpers/client/span-messages";

const JSONViewer = dynamic(() => import("@/components/common/json-viewer"), {
	ssr: false,
	loading: () => (
		<div className="text-[10px] text-stone-500 dark:text-stone-400">…</div>
	),
});

export default function StructuredValue({
	value,
	markdown = false,
	bodyClassName,
}: {
	value: unknown;
	markdown?: boolean;
	bodyClassName?: string;
}) {
	const m = getMessage();
	const [showRaw, setShowRaw] = useState(false);
	const content = useMemo(() => parseStructuredValue(value), [value]);
	const raw = useMemo(() => stringifyValue(value), [value]);
	const formatted =
		content.kind === "messages" ||
		content.kind === "json" ||
		(content.kind === "text" && markdown);

	return (
		<div className="min-w-0 max-w-full">
			{formatted && (
				<div className="flex justify-end">
					<button
						type="button"
						className="text-[10px] font-medium text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
						onClick={() => setShowRaw((current) => !current)}
					>
						{showRaw ? m.OBSERVABILITY_FORMATTED : m.OBSERVABILITY_RAW}
					</button>
				</div>
			)}
			<div className={bodyClassName}>
				{!formatted || showRaw ? (
					<pre className="max-w-full whitespace-pre-wrap break-words font-mono text-xs leading-5 text-stone-800 dark:text-stone-200">
						{raw}
					</pre>
				) : content.kind === "messages" ? (
					<div className="flex flex-col gap-2">
						{content.messages.map((message, index) => (
							<div
								key={index}
								className="rounded-md border border-stone-200 bg-white px-2.5 py-2 dark:border-stone-800 dark:bg-stone-950"
							>
								<div className="text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
									{message.role}
								</div>
								<Markdown
									className="mt-1 text-xs leading-5 text-stone-800 dark:text-stone-200"
									content={message.content}
								/>
							</div>
						))}
					</div>
				) : content.kind === "json" ? (
					<JSONViewer value={content.value} />
				) : (
					<Markdown
						className="text-xs leading-5 text-stone-800 dark:text-stone-200"
						content={raw}
					/>
				)}
			</div>
		</div>
	);
}
