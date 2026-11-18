"use client";

import { memo, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeBlock from "@/components/common/code-block";
import { cn } from "@/lib/utils";

const REMARK_PLUGINS = [remarkGfm];
const HEADING_CLASS = "mb-1 mt-2 font-semibold";
const CELL_CLASS = "border border-stone-200 px-2 py-1 dark:border-stone-700";

// Sizes and colours are inherited, so each caller sets them on the wrapper.
const components: Components = {
	h1: ({ children }) => <h1 className={`${HEADING_CLASS} text-[1.2em]`}>{children}</h1>,
	h2: ({ children }) => <h2 className={`${HEADING_CLASS} text-[1.1em]`}>{children}</h2>,
	h3: ({ children }) => <h3 className={HEADING_CLASS}>{children}</h3>,
	h4: ({ children }) => <h4 className={HEADING_CLASS}>{children}</h4>,
	h5: ({ children }) => <h5 className={HEADING_CLASS}>{children}</h5>,
	h6: ({ children }) => <h6 className={HEADING_CLASS}>{children}</h6>,
	p: ({ children }) => <p className="my-1.5 whitespace-pre-wrap">{children}</p>,
	ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
	ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
	strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
	blockquote: ({ children }) => (
		<blockquote className="my-1.5 border-l-2 border-stone-300 pl-3 italic dark:border-stone-600">
			{children}
		</blockquote>
	),
	hr: () => <hr className="my-3 border-stone-200 dark:border-stone-700" />,
	a: ({ href, children }) => (
		<a
			href={href}
			className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
			target="_blank"
			rel="noopener noreferrer"
		>
			{children}
		</a>
	),
	// Model output must not be able to load attacker URLs, so an image is shown
	// as its text instead of being fetched.
	img: ({ alt, src }) => (
		<span className="italic opacity-70">{alt || (typeof src === "string" ? src : "")}</span>
	),
	table: ({ children }) => (
		<div className="my-1.5 overflow-x-auto">
			<table className="border-collapse text-left">{children}</table>
		</div>
	),
	th: ({ children }) => (
		<th className={`${CELL_CLASS} bg-stone-100 font-semibold dark:bg-stone-800`}>{children}</th>
	),
	td: ({ children }) => <td className={CELL_CLASS}>{children}</td>,
	code: ({ children }) => (
		<code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.9em] text-stone-900 dark:bg-stone-700 dark:text-stone-300">
			{children}
		</code>
	),
	// Only fenced and indented code reach `pre`, and a fence without a language
	// has no className, so this is the reliable place to tell block from inline.
	pre: ({ children }) => {
		const { className, children: code } = (
			children as ReactElement<{ className?: string; children?: ReactNode }>
		).props;
		return (
			<CodeBlock
				code={String(code).replace(/\n$/, "")}
				language={/language-(\S+)/.exec(className || "")?.[1] || "text"}
			/>
		);
	},
};

function Markdown({ className, content }: { className?: string; content: string }) {
	return (
		<div className={cn("min-w-0 break-words [&>:first-child]:mt-0 [&>:last-child]:mb-0", className)}>
			<ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
				{content}
			</ReactMarkdown>
		</div>
	);
}

export default memo(Markdown);
