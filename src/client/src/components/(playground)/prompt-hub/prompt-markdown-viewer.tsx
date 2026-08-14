"use client";

import getMessage from "@/constants/messages";
import ReactMarkdown from "react-markdown";

const m = getMessage();

export default function PromptMarkdownViewer({ value }: { value: string }) {
	return (
		<div className="h-full min-h-[300px] overflow-auto rounded-md border border-stone-200 bg-white px-5 py-4 dark:border-stone-800 dark:bg-stone-950">
			{value ? (
				<div className="prose prose-sm max-w-none prose-stone prose-headings:font-semibold prose-p:leading-6 prose-li:leading-6 prose-code:rounded prose-code:bg-stone-100 prose-code:px-1 prose-pre:border prose-pre:border-stone-200 prose-pre:bg-stone-50 dark:prose-invert dark:prose-code:bg-stone-800 dark:prose-pre:border-stone-800 dark:prose-pre:bg-stone-900">
					<ReactMarkdown>{value}</ReactMarkdown>
				</div>
			) : (
				<p className="text-sm italic text-stone-400 dark:text-stone-600">
					{m.PROMPT_HUB_NOTHING_TO_PREVIEW}
				</p>
			)}
		</div>
	);
}
