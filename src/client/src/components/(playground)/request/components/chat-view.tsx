"use client";

/**
 * Chat View — Renders LLM trace spans as a conversational chat timeline.
 *
 * ## Sequencing logic
 *
 * 1. Flatten the hierarchy tree into a flat list of all spans.
 * 2. Sort spans by their Timestamp (wall-clock start time, ascending).
 * 3. For each span, extract chat items (messages, tool calls, indicators).
 * 4. Deduplicate: the root span (and any parent that wraps child LLM calls)
 *    often echoes the full conversation. We skip message extraction for any
 *    span whose children already produced messages, to avoid double-rendering
 *    the same user prompt / assistant response at two tree levels.
 * 5. All items are globally sorted by wall-clock timestampMs.
 */

import { TraceHeirarchySpan } from "@/types/trace";
import { useRequest } from "../request-context";
import {
	getSpanDurationDisplay,
	getSpanCostFormatted,
} from "@/helpers/client/trace";
import {
	Bot,
	ChevronDown,
	ChevronRight,
	Clock,
	Cog,
	DollarSign,
	MessageSquare,
	User,
	Wrench,
} from "lucide-react";
import { useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type ChatItemType = "message" | "tool-indicator" | "span-indicator";

interface ChatItem {
	type: ChatItemType;
	role?: "user" | "assistant" | "system" | "tool";
	content?: string;
	label?: string;
	meta?: string;
	/** Tool type (e.g. "function") */
	toolType?: string;
	/** Tool call arguments (full, for expandable display) */
	toolArgs?: string;
	span: TraceHeirarchySpan;
	timestampMs: number;
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

function parseTimestampMs(ts?: string): number {
	if (!ts) return 0;
	const withZ = ts.endsWith("Z") ? ts : ts + "Z";
	const ms = new Date(withZ).getTime();
	return isNaN(ms) ? 0 : ms;
}

function tryParseJson(raw: unknown): any[] | null {
	if (raw == null) return null;
	try {
		const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function extractTextMessages(
	raw: unknown
): { role: string; content: string }[] {
	const arr = tryParseJson(raw);
	if (!arr) return [];

	const result: { role: string; content: string }[] = [];
	for (const msg of arr) {
		if (!msg) continue;
		const role = msg.role || "unknown";

		if (Array.isArray(msg.parts)) {
			const texts: string[] = [];
			for (const p of msg.parts) {
				if (p?.type === "text" && typeof p.content === "string" && p.content) {
					texts.push(p.content);
				}
			}
			if (texts.length > 0) {
				result.push({ role, content: texts.join("\n") });
			}
			continue;
		}

		if (typeof msg.content === "string" && msg.content.trim()) {
			result.push({ role, content: msg.content });
			continue;
		}

		if (Array.isArray(msg.content)) {
			const texts: string[] = [];
			for (const part of msg.content) {
				if (part?.type === "text" && typeof part.text === "string") {
					texts.push(part.text);
				}
			}
			if (texts.length > 0) {
				result.push({ role, content: texts.join("\n") });
			}
		}
	}
	return result;
}

function normalizeRole(role: string): "user" | "assistant" | "system" | "tool" {
	if (role === "assistant") return "assistant";
	if (role === "system") return "system";
	if (role === "tool" || role === "function") return "tool";
	return "user";
}

function tryPrettyJson(raw: string): string | null {
	try {
		const parsed = JSON.parse(raw);
		return JSON.stringify(parsed, null, 2);
	} catch {
		return null;
	}
}

// ─── Item extraction ─────────────────────────────────────────────────────────

/**
 * Check if a span has LLM message attributes (input or output).
 */
function spanHasMessages(span: TraceHeirarchySpan): boolean {
	const attrs = span.SpanAttributes || {};
	return !!(
		attrs["gen_ai.input.messages"] ||
		attrs["gen_ai.output.messages"] ||
		attrs["gen_ai.content.prompt"] ||
		attrs["gen_ai.content.completion"] ||
		attrs["gen_ai.request.input"] ||
		attrs["gen_ai.response.output"]
	);
}

/**
 * Check if any descendant (child, grandchild, etc.) has messages.
 */
function anyDescendantHasMessages(span: TraceHeirarchySpan): boolean {
	if (!span.children) return false;
	for (const child of span.children) {
		if (spanHasMessages(child) || anyDescendantHasMessages(child)) {
			return true;
		}
	}
	return false;
}

function extractItemsFromSpan(
	span: TraceHeirarchySpan,
	skipMessages: boolean
): ChatItem[] {
	const attrs = span.SpanAttributes || {};
	const items: ChatItem[] = [];
	const ts = parseTimestampMs(span.Timestamp);
	const spanDurationMs = span.Duration / 1e6;

	if (!skipMessages) {
		// ── Input messages ──
		const inputMsgs = extractTextMessages(attrs["gen_ai.input.messages"]);
		if (inputMsgs.length > 0) {
			for (const msg of inputMsgs) {
				items.push({
					type: "message",
					role: normalizeRole(msg.role),
					content: msg.content,
					span,
					timestampMs: ts,
				});
			}
		} else {
			const prompt =
				(attrs["gen_ai.content.prompt"] as string) ||
				(attrs["gen_ai.request.input"] as string);
			if (prompt && prompt.trim()) {
				items.push({
					type: "message",
					role: "user",
					content: prompt,
					span,
					timestampMs: ts,
				});
			}
		}

		// ── Output messages ──
		const outputMsgs = extractTextMessages(attrs["gen_ai.output.messages"]);
		if (outputMsgs.length > 0) {
			for (const msg of outputMsgs) {
				items.push({
					type: "message",
					role: normalizeRole(msg.role),
					content: msg.content,
					span,
					timestampMs: ts + spanDurationMs,
				});
			}
		} else {
			const response =
				(attrs["gen_ai.content.completion"] as string) ||
				(attrs["gen_ai.response.output"] as string);
			if (response && response.trim()) {
				items.push({
					type: "message",
					role: "assistant",
					content: response,
					span,
					timestampMs: ts + spanDurationMs,
				});
			}
		}
	}

	// ── Tool call indicator (always shown — these are actions, not duplicated) ──
	const toolName = attrs["gen_ai.tool.name"] as string | undefined;
	const toolCallId = attrs["gen_ai.tool.call.id"] as string | undefined;
	const toolArgs = attrs["gen_ai.tool.call.arguments"] as string | undefined;
	const toolType = attrs["gen_ai.tool.type"] as string | undefined;
	if (toolName) {
		items.push({
			type: "tool-indicator",
			label: toolName,
			meta: toolCallId || undefined,
			toolType: toolType || undefined,
			toolArgs: toolArgs || undefined,
			span,
			timestampMs: ts + spanDurationMs * 0.5,
		});
	}

	// ── Non-LLM span indicator ──
	if (items.length === 0) {
		const spanKind =
			(attrs["gen_ai.operation.name"] as string) ||
			(attrs["openai.api_type"] as string);
		const isInteresting =
			spanKind ||
			span.SpanName.match(
				/retriev|embed|search|tool|function|db|query|fetch|call/i
			);
		if (isInteresting) {
			items.push({
				type: "span-indicator",
				label: span.SpanName,
				meta: spanKind || undefined,
				span,
				timestampMs: ts,
			});
		}
	}

	return items;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ToolIndicator({
	item,
	isSelected,
	onClick,
}: {
	item: ChatItem;
	isSelected: boolean;
	onClick: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const prettyArgs = item.toolArgs ? tryPrettyJson(item.toolArgs) : null;
	const displayArgs = prettyArgs || item.toolArgs;

	return (
		<div
			className={`mx-3 rounded-lg border cursor-pointer transition-colors ${
				isSelected
					? "border-primary/40 bg-primary/5"
					: "border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/50 hover:bg-stone-100 dark:hover:bg-stone-800"
			}`}
			onClick={onClick}
		>
			{/* Header row */}
			<div className="flex items-center gap-2 px-3 py-2">
				<div className="flex items-center justify-center h-6 w-6 rounded-md bg-violet-100 dark:bg-violet-900/40 shrink-0">
					<Wrench className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
				</div>
				<div className="flex flex-col min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">
							{item.label}
						</span>
						{item.toolType && (
							<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-medium">
								{item.toolType}
							</span>
						)}
					</div>
					{item.meta && (
						<span className="text-[9px] text-stone-400 dark:text-stone-500 font-mono truncate">
							{item.meta}
						</span>
					)}
				</div>
				<span className="text-[9px] tabular-nums text-stone-400 dark:text-stone-500 shrink-0">
					{getSpanDurationDisplay(item.span)}
				</span>
			</div>

			{/* Expandable arguments */}
			{displayArgs && (
				<div className="border-t border-stone-200 dark:border-stone-700">
					<button
						className="flex items-center gap-1 px-3 py-1 text-[10px] text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 w-full"
						onClick={(e) => {
							e.stopPropagation();
							setExpanded(!expanded);
						}}
					>
						{expanded ? (
							<ChevronDown className="h-3 w-3" />
						) : (
							<ChevronRight className="h-3 w-3" />
						)}
						Arguments
					</button>
					{expanded && (
						<pre className="px-3 pb-2 text-[10px] leading-relaxed text-stone-600 dark:text-stone-400 font-mono overflow-x-auto max-h-48 overflow-y-auto">
							{displayArgs}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}

// ─── Role configs ────────────────────────────────────────────────────────────

const roleConfig = {
	user: {
		icon: <User className="h-3.5 w-3.5" />,
		label: "User",
		align: "items-end" as const,
		bubble:
			"bg-primary/10 dark:bg-primary/15 text-stone-800 dark:text-stone-200 rounded-2xl rounded-br-md",
	},
	assistant: {
		icon: <Bot className="h-3.5 w-3.5" />,
		label: "Assistant",
		align: "items-start" as const,
		bubble:
			"bg-stone-200 dark:bg-stone-800 text-stone-800 dark:text-stone-200 rounded-2xl rounded-bl-md",
	},
	system: {
		icon: <Cog className="h-3.5 w-3.5" />,
		label: "System",
		align: "items-start" as const,
		bubble:
			"bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 rounded-2xl rounded-bl-md border border-amber-200 dark:border-amber-800",
	},
	tool: {
		icon: <Wrench className="h-3.5 w-3.5" />,
		label: "Tool Result",
		align: "items-start" as const,
		bubble:
			"bg-violet-50 dark:bg-violet-950/30 text-violet-900 dark:text-violet-200 rounded-2xl rounded-bl-md border border-violet-200 dark:border-violet-800",
	},
};

// ─── Main component ──────────────────────────────────────────────────────────

function flattenSpans(
	span: TraceHeirarchySpan,
	result: TraceHeirarchySpan[]
): void {
	result.push(span);
	if (span.children) {
		for (const child of span.children) {
			flattenSpans(child, result);
		}
	}
}

export default function ChatView({
	record,
}: {
	record: TraceHeirarchySpan;
}) {
	const [request, updateRequest] = useRequest();

	// 1. Flatten tree
	const allSpans: TraceHeirarchySpan[] = [];
	flattenSpans(record, allSpans);

	// 2. Sort by wall-clock start time
	allSpans.sort(
		(a, b) => parseTimestampMs(a.Timestamp) - parseTimestampMs(b.Timestamp)
	);

	// 3. Build a set of SpanIds whose messages should be skipped because
	//    their descendants already carry the same conversation.
	const skipMessageSpanIds = new Set<string>();
	for (const span of allSpans) {
		if (
			spanHasMessages(span) &&
			span.children &&
			span.children.length > 0 &&
			anyDescendantHasMessages(span)
		) {
			skipMessageSpanIds.add(span.SpanId);
		}
	}

	// 4. Extract items
	const allItems: ChatItem[] = [];
	for (const span of allSpans) {
		const skip = skipMessageSpanIds.has(span.SpanId);
		allItems.push(...extractItemsFromSpan(span, skip));
	}
	allItems.sort((a, b) => a.timestampMs - b.timestampMs);

	// 5. Empty state
	if (allItems.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-stone-400 dark:text-stone-500 gap-2 py-12">
				<MessageSquare className="h-8 w-8" />
				<p className="text-sm">No chat messages found in this trace</p>
				<p className="text-xs">
					This view works with LLM spans that have prompt/response data
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2.5 py-3">
			{allItems.map((item, i) => {
				const isSelected = request?.spanId === item.span.SpanId;

				// ── Tool call indicator ──
				if (item.type === "tool-indicator") {
					return (
						<ToolIndicator
							key={`${item.span.SpanId}-tool-${i}`}
							item={item}
							isSelected={isSelected}
							onClick={() =>
								updateRequest({ spanId: item.span.SpanId })
							}
						/>
					);
				}

				// ── Non-LLM span indicator ──
				if (item.type === "span-indicator") {
					return (
						<div
							key={`${item.span.SpanId}-span-${i}`}
							className={`flex items-center gap-2 mx-3 px-3 py-1.5 rounded-md border cursor-pointer transition-colors ${
								isSelected
									? "border-primary/40 bg-primary/5"
									: "border-dashed border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
							}`}
							onClick={() =>
								updateRequest({ spanId: item.span.SpanId })
							}
						>
							<Cog className="h-3 w-3 shrink-0 text-stone-400" />
							<span className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
								{item.label}
							</span>
							{item.meta && (
								<span className="text-[10px] text-stone-400 dark:text-stone-500">
									({item.meta})
								</span>
							)}
							<span className="ml-auto text-[9px] tabular-nums text-stone-400 dark:text-stone-500 shrink-0">
								{getSpanDurationDisplay(item.span)}
							</span>
						</div>
					);
				}

				// ── Chat message bubble ──
				const role = item.role!;
				const config = roleConfig[role];
				const durationDisplay = getSpanDurationDisplay(item.span);
				const costDisplay = getSpanCostFormatted(item.span, 6);

				return (
					<div
						key={`${item.span.SpanId}-${role}-${i}`}
						className={`flex flex-col gap-0.5 px-3 ${config.align}`}
					>
						{/* Role label + span name */}
						<div
							className={`flex items-center gap-1.5 text-[10px] text-stone-400 dark:text-stone-500 px-1 ${
								role === "user" ? "flex-row-reverse" : ""
							}`}
						>
							{config.icon}
							<span className="font-medium">{config.label}</span>
							<span className="text-stone-300 dark:text-stone-600">
								|
							</span>
							<span className="truncate max-w-[120px]">
								{item.span.SpanName}
							</span>
						</div>

						{/* Bubble */}
						<div
							className={`max-w-[85%] px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words cursor-pointer transition-shadow ${
								config.bubble
							} ${
								isSelected
									? "ring-2 ring-primary ring-offset-1 dark:ring-offset-stone-900"
									: "hover:shadow-md"
							}`}
							onClick={() =>
								updateRequest({ spanId: item.span.SpanId })
							}
						>
							{item.content}
						</div>

						{/* Duration + cost for assistant messages */}
						{role === "assistant" && (
							<div className="flex items-center gap-2 text-[9px] text-stone-400 dark:text-stone-500 px-1 mt-0.5">
								<span className="flex items-center gap-0.5">
									<Clock className="h-2.5 w-2.5" />
									{durationDisplay}
								</span>
								{costDisplay && (
									<span className="flex items-center gap-0.5">
										<DollarSign className="h-2.5 w-2.5" />
										{costDisplay}
									</span>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
