"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import SqlBlock from "./sql-block";
import EntityCard from "./entity-card";
import DashboardImportCard from "./dashboard-import-card";
import getMessage from "@/constants/messages";
import { Coins, Clock, Database, User, Bot } from "lucide-react";

interface EntityLink {
	type: string;
	id?: string;
	name: string;
	url: string;
}

/**
 * Parse ```entities and ```dashboard blocks from LLM response.
 * Returns clean text and parsed structured data.
 */
function parseStructuredBlocks(text: string): {
	cleanText: string;
	entities: EntityLink[];
	dashboards: string[];
} {
	const entities: EntityLink[] = [];
	const dashboards: string[] = [];

	// Parse ```entities blocks
	const entitiesRegex = /```entities\s*\n([\s\S]*?)```/g;
	let match;
	while ((match = entitiesRegex.exec(text)) !== null) {
		try {
			const parsed = JSON.parse(match[1].trim());
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					if (item.type && item.url) {
						entities.push({
							type: item.type,
							id: item.id || "",
							name: item.name || item.type,
							url: item.url,
						});
					}
				}
			}
		} catch {
			// Invalid JSON — skip
		}
	}

	// Parse ```dashboard blocks
	const dashboardRegex = /```dashboard\s*\n([\s\S]*?)```/g;
	while ((match = dashboardRegex.exec(text)) !== null) {
		const json = match[1].trim();
		if (json) dashboards.push(json);
	}

	const cleanText = text
		.replace(/```entities\s*\n[\s\S]*?```/g, "")
		.replace(/```dashboard\s*\n[\s\S]*?```/g, "")
		.trim();

	return { cleanText, entities, dashboards };
}

interface MessageBubbleProps {
	role: "user" | "assistant";
	content: string;
	promptTokens?: number;
	completionTokens?: number;
	cost?: number;
	queryRowsRead?: number;
	queryExecutionTimeMs?: number;
	createdAt?: string;
	isStreaming?: boolean;
	onExecuteQuery?: (
		query: string,
		messageId?: string
	) => Promise<{ data?: any[]; stats?: any; err?: string }>;
	messageId?: string;
}

const StreamingMessage = () => (
	<div className="flex items-center gap-1.5 mt-1">
		<div className="h-2 w-2 rounded-full bg-stone-400 dark:bg-stone-500 animate-pulse" />
		<div className="h-2 w-2 rounded-full bg-stone-400 dark:bg-stone-500 animate-pulse [animation-delay:150ms]" />
		<div className="h-2 w-2 rounded-full bg-stone-400 dark:bg-stone-500 animate-pulse [animation-delay:300ms]" />
	</div>
);

export default function MessageBubble({
	role,
	content,
	promptTokens,
	completionTokens,
	cost,
	queryRowsRead,
	queryExecutionTimeMs,
	isStreaming,
	onExecuteQuery,
	messageId,
}: MessageBubbleProps) {
	const m = getMessage();
	const hasStats =
		(promptTokens && promptTokens > 0) ||
		(cost && cost > 0) ||
		(queryRowsRead && queryRowsRead > 0);

	// During streaming, pass raw content to ReactMarkdown (it handles incomplete code blocks).
	// After streaming completes, parse and strip structured blocks for clean rendering.
	const { cleanText, entities, dashboards } = useMemo(() => {
		if (isStreaming) {
			return { cleanText: content || "", entities: [], dashboards: [] };
		}
		return parseStructuredBlocks(content || "");
	}, [content, isStreaming]);

	if (role === "user") {
		return (
			<div className="flex justify-end py-4">
				<div className="flex gap-3 max-w-[80%]">
					<div className="flex-1 min-w-0 pt-0.5">
						<div className="rounded-2xl rounded-br-sm bg-stone-100 dark:bg-stone-800 px-4 py-3">
							<p className="text-sm leading-relaxed text-stone-900 dark:text-stone-300 whitespace-pre-wrap">
								{content}
							</p>
						</div>
					</div>
					<div className="flex-shrink-0 w-8 h-8 rounded-full bg-stone-200 dark:bg-stone-700 flex items-center justify-center">
						<User className="h-4 w-4 text-stone-600 dark:text-stone-300" />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex gap-3 py-4">
			<div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
				<Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
			</div>
			<div className="flex-1 min-w-0 pt-0.5">
				{cleanText && (
					<div className="chat-markdown">
						<ReactMarkdown
							components={{
								p({ children }) {
									return (
										<p className="text-sm leading-relaxed text-stone-800 dark:text-stone-100 my-2">
											{children}
										</p>
									);
								},
								h1({ children }) {
									return (
										<h1 className="text-xl font-bold text-stone-900 dark:text-stone-300 mt-4 mb-2">
											{children}
										</h1>
									);
								},
								h2({ children }) {
									return (
										<h2 className="text-lg font-semibold text-stone-900 dark:text-stone-300 mt-3 mb-2">
											{children}
										</h2>
									);
								},
								h3({ children }) {
									return (
										<h3 className="text-base font-semibold text-stone-900 dark:text-stone-300 mt-3 mb-1">
											{children}
										</h3>
									);
								},
								strong({ children }) {
									return (
										<strong className="font-semibold text-stone-900 dark:text-stone-300">
											{children}
										</strong>
									);
								},
								em({ children }) {
									return (
										<em className="italic text-stone-700 dark:text-stone-200">
											{children}
										</em>
									);
								},
								ul({ children }) {
									return (
										<ul className="list-disc pl-5 my-2 space-y-1 text-sm text-stone-800 dark:text-stone-100">
											{children}
										</ul>
									);
								},
								ol({ children }) {
									return (
										<ol className="list-decimal pl-5 my-2 space-y-1 text-sm text-stone-800 dark:text-stone-100">
											{children}
										</ol>
									);
								},
								li({ children }) {
									return (
										<li className="text-sm leading-relaxed text-stone-800 dark:text-stone-100">
											{children}
										</li>
									);
								},
								a({ href, children }) {
									return (
										<a
											href={href}
											className="text-blue-600 dark:text-blue-400 underline hover:text-blue-700 dark:hover:text-blue-300"
											target="_blank"
											rel="noopener noreferrer"
										>
											{children}
										</a>
									);
								},
								blockquote({ children }) {
									return (
										<blockquote className="border-l-2 border-stone-300 dark:border-stone-600 pl-4 my-2 italic text-stone-600 dark:text-stone-300">
											{children}
										</blockquote>
									);
								},
								hr() {
									return <hr className="my-4 border-stone-200 dark:border-stone-700" />;
								},
								code({ className, children, ...props }) {
									const match = /language-(\w+)/.exec(className || "");
									const lang = match?.[1];

									if (lang === "sql") {
										return (
											<SqlBlock
												code={String(children).replace(/\n$/, "")}
												messageId={messageId}
												onExecute={onExecuteQuery}
											/>
										);
									}

									if (lang === "dashboard") {
										return (
											<DashboardImportCard
												dashboardJson={String(children).replace(/\n$/, "")}
											/>
										);
									}

									if (lang === "entities") {
										// Entities blocks are parsed separately — hide from markdown
										return null;
									}

									// Block code (has className like language-*)
									if (className) {
										return (
											<pre className="rounded-lg bg-stone-100 dark:bg-stone-800 p-4 overflow-x-auto my-3">
												<code className="text-[14px] font-mono text-stone-800 dark:text-stone-100">
													{children}
												</code>
											</pre>
										);
									}

									// Inline code
									return (
										<code
											className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-700 text-[14px] font-mono text-stone-900 dark:text-stone-300"
											{...props}
										>
											{children}
										</code>
									);
								},
								pre({ children }) {
									return <>{children}</>;
								},
							}}
						>
							{cleanText}
						</ReactMarkdown>
					</div>
				)}

				{/* Dashboard import cards */}
				{dashboards.length > 0 && !isStreaming && (
					<div className="mt-3">
						{dashboards.map((json, i) => (
							<DashboardImportCard key={i} dashboardJson={json} />
						))}
					</div>
				)}

				{/* Entity link cards from LLM-generated ```entities blocks */}
				{entities.length > 0 && !isStreaming && (
					<div className="flex flex-col gap-1.5 mt-3 max-w-sm">
						{entities.map((entity, i) => (
							<EntityCard
								key={`${entity.type}-${entity.id || i}`}
								type={entity.type}
								name={entity.name}
								url={entity.url}
							/>
						))}
					</div>
				)}

				{/* Streaming indicator */}
				{isStreaming && (
					<StreamingMessage />
				)}

				{/* Stats footer */}
				{hasStats && !isStreaming && (
					<div className="flex items-center gap-4 mt-2.5 text-xs text-stone-500 dark:text-stone-400">
						{promptTokens !== undefined && promptTokens > 0 && (
							<span className="flex items-center gap-1">
								<Database className="h-3 w-3" />
								{promptTokens + (completionTokens || 0)} {m.CHAT_TOKENS}
							</span>
						)}
						{cost !== undefined && cost > 0 && (
							<span className="flex items-center gap-1">
								<Coins className="h-3 w-3" />${cost.toFixed(6)}
							</span>
						)}
						{queryExecutionTimeMs !== undefined && queryExecutionTimeMs > 0 && (
							<span className="flex items-center gap-1">
								<Clock className="h-3 w-3" />
								{queryExecutionTimeMs}ms
								{queryRowsRead ? ` / ${queryRowsRead} ${m.CHAT_ROWS}` : ""}
							</span>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
