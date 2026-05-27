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
	Brain,
	ChevronDown,
	ChevronRight,
	Clock,
	Cog,
	DollarSign,
	FileEdit,
	MessageSquare,
	Network,
	User,
	Wrench,
} from "lucide-react";
import { useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type ChatItemType =
	| "message"
	| "tool-indicator"
	| "span-indicator"
	| "thought"
	| "edit"
	| "subagent";

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
	/** Tool call result (for coding-agent tool spans) */
	toolResult?: string;
	/** Free-form details, e.g. subagent summary or edit diff stats */
	details?: string;
	/** Optional sub-label, e.g. file path / mcp server / cwd */
	subLabel?: string;
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
	raw: unknown,
	defaultRole: "user" | "assistant" = "user"
): { role: string; content: string }[] {
	if (raw == null) return [];
	// The CLI emits `gen_ai.{input,output}.messages` per the OTel
	// GenAI semantic convention (https://github.com/open-telemetry/
	// semantic-conventions-genai → docs/gen-ai/gen-ai-spans.md):
	//   [{ role, parts: [{ type: "text", content: "..." },
	//                    { type: "tool_call",          ... },
	//                    { type: "tool_call_response", ... }],
	//      finish_reason? }]
	// Legacy paths fall back to a plain string body and to OpenAI's
	// `content: "..."` / `content: [{type:"text", text:"..."}]` so
	// vendors mid-migration still render.
	const arr = tryParseJson(raw);
	if (!arr) {
		if (typeof raw === "string" && raw.trim()) {
			return [{ role: defaultRole, content: raw }];
		}
		return [];
	}

	const result: { role: string; content: string }[] = [];
	for (const msg of arr) {
		if (!msg) continue;
		const role = msg.role || "unknown";

		if (Array.isArray(msg.parts)) {
			const lines: string[] = [];
			for (const p of msg.parts) {
				if (!p?.type) continue;
				if (p.type === "text") {
					// OTel canonical uses `content`; legacy emitters
					// may use `text` — accept both for resilience.
					const t =
						(typeof p.content === "string" && p.content) ||
						(typeof p.text === "string" && p.text) ||
						"";
					if (t) lines.push(t);
				} else if (p.type === "tool_call") {
					const args =
						typeof p.arguments === "string"
							? p.arguments
							: p.arguments != null
								? JSON.stringify(p.arguments)
								: "";
					lines.push(
						`🛠 ${p.name || "tool_call"}${p.id ? ` (${p.id})` : ""}${
							args ? `\n${args}` : ""
						}`
					);
				} else if (p.type === "tool_call_response") {
					const r =
						typeof p.result === "string"
							? p.result
							: p.result != null
								? JSON.stringify(p.result)
								: "";
					lines.push(
						`↩ tool_result${p.id ? ` (${p.id})` : ""}${p.is_error ? " · error" : ""}${
							r ? `\n${r}` : ""
						}`
					);
				}
			}
			if (lines.length > 0) {
				result.push({ role, content: lines.join("\n\n") });
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
	const isCodingLLMTurn = span.SpanName === "coding_agent.llm.turn";

	// Coding-agent llm.turn carries a `kind` attribute that disambiguates
	// what the span represents:
	//   - "user_prompt"     → user message body lives in input.messages
	//   - "assistant_only"  → assistant body lives in output.messages
	//   - empty + thought   → thinking-only turn (no user-visible message)
	const codingTurnKind = attrs["coding_agent.llm.turn.kind"] as string | undefined;

	if (!skipMessages) {
		// ── Input messages ──
		const inputMsgs = extractTextMessages(attrs["gen_ai.input.messages"], "user");
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
		const outputMsgs = extractTextMessages(
			attrs["gen_ai.output.messages"],
			"assistant"
		);
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

		// ── Reasoning / thinking text (coding-agent only) ──
		const thoughtText = attrs["coding_agent.llm.thought.text"] as
			| string
			| undefined;
		if (thoughtText && thoughtText.trim()) {
			const thoughtMs = Number(
				attrs["coding_agent.llm.thought.duration_ms"] || 0
			);
			items.push({
				type: "thought",
				content: thoughtText,
				meta:
					thoughtMs > 0
						? `${(thoughtMs / 1000).toFixed(1)}s of thinking`
						: undefined,
				span,
				timestampMs: ts + spanDurationMs * 0.25,
			});
		}
	}

	// ── Tool call indicator (always shown — these are actions, not duplicated) ──
	// Coding-agent tool.call spans carry the same gen_ai.tool.* attrs, plus
	// optional MCP server name, command (for shell tools), cwd, and the tool
	// result. We surface those alongside the standard fields.
	const toolName = attrs["gen_ai.tool.name"] as string | undefined;
	const toolCallId = attrs["gen_ai.tool.call.id"] as string | undefined;
	const toolArgs = attrs["gen_ai.tool.call.arguments"] as string | undefined;
	const toolType = attrs["gen_ai.tool.type"] as string | undefined;
	const toolResult = attrs["gen_ai.tool.call.result"] as string | undefined;
	const toolCommand = attrs["coding_agent.tool.command"] as string | undefined;
	const toolCwd = attrs["code.cwd"] as string | undefined;
	const toolMCPServer = attrs["coding_agent.mcp.server.name"] as
		| string
		| undefined;
	const toolErrorType = attrs["error.type"] as string | undefined;
	if (toolName) {
		const subLabelParts: string[] = [];
		if (toolMCPServer) subLabelParts.push(`MCP: ${toolMCPServer}`);
		if (toolCwd) subLabelParts.push(toolCwd);
		items.push({
			type: "tool-indicator",
			label: toolName,
			meta: toolCallId || undefined,
			toolType: toolType || (toolErrorType ? `error: ${toolErrorType}` : undefined),
			// Prefer the structured arguments JSON; if absent, surface the raw
			// shell command so shell-style tool calls (Bash, run_shell) are
			// still readable in the chat view.
			toolArgs: toolArgs || toolCommand || undefined,
			toolResult: toolResult || undefined,
			subLabel: subLabelParts.join(" • ") || undefined,
			span,
			timestampMs: ts + spanDurationMs * 0.5,
		});
	}

	// ── Edit decision (coding-agent only) ──
	if (span.SpanName === "coding_agent.edit.decision") {
		const filePath = attrs["code.file.path"] as string | undefined;
		const decision = attrs["coding_agent.edit.decision"] as string | undefined;
		const linesAdded = Number(attrs["coding_agent.edit.lines_added"] || 0);
		const linesRemoved = Number(attrs["coding_agent.edit.lines_removed"] || 0);
		const lang = attrs["coding_agent.edit.language"] as string | undefined;
		items.push({
			type: "edit",
			label: decision || "edit",
			subLabel: filePath || undefined,
			meta: lang || undefined,
			details:
				linesAdded || linesRemoved
					? `+${linesAdded} / -${linesRemoved}`
					: undefined,
			span,
			timestampMs: ts,
		});
	}

	// ── Subagent (coding-agent only) ──
	if (span.SpanName === "coding_agent.subagent") {
		const subagentType = attrs["coding_agent.subagent.type"] as string | undefined;
		const task = attrs["coding_agent.subagent.task"] as string | undefined;
		const summary = attrs["coding_agent.subagent.summary"] as string | undefined;
		items.push({
			type: "subagent",
			label: subagentType || "subagent",
			content: task || undefined,
			details: summary || undefined,
			span,
			timestampMs: ts,
		});
	}

	// ── Non-LLM span indicator ──
	// Only fall through when the span produced nothing else above. We
	// also explicitly skip the coding_agent.session root span (it carries
	// session-level metadata that's surfaced in the header, not the chat).
	if (
		items.length === 0 &&
		span.SpanName !== "coding_agent.session" &&
		!isCodingLLMTurn
	) {
		const spanKind =
			(attrs["gen_ai.operation.name"] as string) ||
			(attrs["openai.api_type"] as string) ||
			codingTurnKind;
		const isInteresting =
			spanKind ||
			span.SpanName.match(
				/retriev|embed|search|tool|function|db|query|fetch|call|coding_agent/i
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
	const [argsExpanded, setArgsExpanded] = useState(false);
	const [resultExpanded, setResultExpanded] = useState(false);
	const prettyArgs = item.toolArgs ? tryPrettyJson(item.toolArgs) : null;
	const displayArgs = prettyArgs || item.toolArgs;
	const prettyResult = item.toolResult ? tryPrettyJson(item.toolResult) : null;
	const displayResult = prettyResult || item.toolResult;
	const isMCP = !!item.subLabel?.startsWith("MCP:");

	return (
		<div
			className={`mx-2 cursor-pointer rounded-md border transition-colors ${
				isSelected
					? "border-primary/40 bg-primary/5"
					: "border-stone-200 bg-white hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900"
			}`}
			onClick={onClick}
		>
			{/* Header row */}
			<div className="flex items-center gap-2 px-2.5 py-1.5">
				<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900">
					{isMCP ? (
						<Network className="h-3 w-3 text-violet-500 dark:text-violet-400" />
					) : item.toolType?.startsWith("error") ? (
						<Wrench className="h-3 w-3 text-rose-500 dark:text-rose-400" />
					) : (
						<Wrench className="h-3 w-3 text-stone-500 dark:text-stone-400" />
					)}
				</div>
				<div className="flex flex-col min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
							{item.label}
						</span>
						{item.toolType && (
							<span
								className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${
									item.toolType.startsWith("error")
										? "border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-300"
										: "border-stone-200 text-stone-500 dark:border-stone-800 dark:text-stone-400"
								}`}
							>
								{item.toolType}
							</span>
						)}
					</div>
					{item.subLabel && (
						<span className="truncate text-[10px] text-stone-500 dark:text-stone-400">
							{item.subLabel}
						</span>
					)}
					{item.meta && (
						<span className="truncate font-mono text-[9px] text-stone-400 dark:text-stone-500">
							{item.meta}
						</span>
					)}
				</div>
				<span className="shrink-0 text-[9px] tabular-nums text-stone-400 dark:text-stone-500">
					{getSpanDurationDisplay(item.span)}
				</span>
			</div>

			{/* Expandable arguments */}
			{displayArgs && (
				<div className="border-t border-stone-200 dark:border-stone-700">
					<button
						className="flex w-full items-center gap-1 px-2.5 py-1 text-[10px] text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
						onClick={(e) => {
							e.stopPropagation();
							setArgsExpanded(!argsExpanded);
						}}
					>
						{argsExpanded ? (
							<ChevronDown className="h-3 w-3" />
						) : (
							<ChevronRight className="h-3 w-3" />
						)}
						Arguments
					</button>
					{argsExpanded && (
						<pre className="max-h-48 overflow-y-auto overflow-x-auto px-2.5 pb-2 font-mono text-[10px] leading-relaxed text-stone-600 dark:text-stone-400">
							{displayArgs}
						</pre>
					)}
				</div>
			)}

			{/* Expandable result */}
			{displayResult && (
				<div className="border-t border-stone-200 dark:border-stone-700">
					<button
						className="flex w-full items-center gap-1 px-2.5 py-1 text-[10px] text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
						onClick={(e) => {
							e.stopPropagation();
							setResultExpanded(!resultExpanded);
						}}
					>
						{resultExpanded ? (
							<ChevronDown className="h-3 w-3" />
						) : (
							<ChevronRight className="h-3 w-3" />
						)}
						Result
					</button>
					{resultExpanded && (
						<pre className="max-h-48 overflow-y-auto overflow-x-auto px-2.5 pb-2 font-mono text-[10px] leading-relaxed text-stone-600 dark:text-stone-400">
							{displayResult}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}

function ThoughtIndicator({
	item,
	isSelected,
	onClick,
}: {
	item: ChatItem;
	isSelected: boolean;
	onClick: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const text = item.content || "";
	const preview = text.length > 280 ? text.slice(0, 280) + "…" : text;
	const showToggle = text.length > 280;
	return (
		<div
			className={`mx-2 cursor-pointer rounded-md border border-dashed transition-colors ${
				isSelected
					? "border-amber-400/60 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-950/30"
					: "border-stone-300 bg-stone-50 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900/40 dark:hover:bg-stone-900"
			}`}
			onClick={onClick}
		>
			<div className="flex items-start gap-2 px-2.5 py-1.5">
				<Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
							Thinking
						</span>
						{item.meta && (
							<span className="text-[10px] text-stone-400 dark:text-stone-500">
								{item.meta}
							</span>
						)}
					</div>
					<pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-stone-700 dark:text-stone-300">
						{expanded || !showToggle ? text : preview}
					</pre>
					{showToggle && (
						<button
							className="mt-0.5 text-[10px] text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
							onClick={(e) => {
								e.stopPropagation();
								setExpanded((v) => !v);
							}}
						>
							{expanded ? "Show less" : "Show more"}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

function EditIndicator({
	item,
	isSelected,
	onClick,
}: {
	item: ChatItem;
	isSelected: boolean;
	onClick: () => void;
}) {
	return (
		<div
			className={`mx-2 flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors ${
				isSelected
					? "border-emerald-400/40 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-950/30"
					: "border-stone-200 bg-white hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900"
			}`}
			onClick={onClick}
		>
			<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900">
				<FileEdit className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex items-center gap-1.5">
					<span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
						{item.label}
					</span>
					{item.meta && (
						<span className="rounded border border-stone-200 px-1.5 py-0.5 text-[9px] font-medium text-stone-500 dark:border-stone-800 dark:text-stone-400">
							{item.meta}
						</span>
					)}
				</div>
				{item.subLabel && (
					<span className="truncate font-mono text-[10px] text-stone-500 dark:text-stone-400">
						{item.subLabel}
					</span>
				)}
			</div>
			{item.details && (
				<span className="shrink-0 font-mono text-[10px] text-stone-500 dark:text-stone-400">
					{item.details}
				</span>
			)}
		</div>
	);
}

function SubagentIndicator({
	item,
	isSelected,
	onClick,
}: {
	item: ChatItem;
	isSelected: boolean;
	onClick: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	return (
		<div
			className={`mx-2 cursor-pointer rounded-md border transition-colors ${
				isSelected
					? "border-violet-400/50 bg-violet-50/70 dark:border-violet-500/50 dark:bg-violet-950/30"
					: "border-stone-200 bg-white hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900"
			}`}
			onClick={onClick}
		>
			<div className="flex items-start gap-2 px-2.5 py-1.5">
				<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900">
					<Bot className="h-3 w-3 text-violet-500 dark:text-violet-400" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">
							Subagent
						</span>
						<span className="text-[10px] text-stone-500 dark:text-stone-400">
							{item.label}
						</span>
					</div>
					{item.content && (
						<p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12px] leading-relaxed text-stone-700 dark:text-stone-300">
							{item.content}
						</p>
					)}
					{item.details && (
						<>
							<button
								className="mt-1 flex items-center gap-1 text-[10px] text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
								onClick={(e) => {
									e.stopPropagation();
									setExpanded((v) => !v);
								}}
							>
								{expanded ? (
									<ChevronDown className="h-3 w-3" />
								) : (
									<ChevronRight className="h-3 w-3" />
								)}
								Summary
							</button>
							{expanded && (
								<pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-stone-600 dark:text-stone-400">
									{item.details}
								</pre>
							)}
						</>
					)}
				</div>
				<span className="shrink-0 text-[9px] tabular-nums text-stone-400 dark:text-stone-500">
					{getSpanDurationDisplay(item.span)}
				</span>
			</div>
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
			"border border-primary/20 bg-primary/5 dark:bg-primary/10 text-stone-800 dark:text-stone-200 rounded-md",
	},
	assistant: {
		icon: <Bot className="h-3.5 w-3.5" />,
		label: "Assistant",
		align: "items-start" as const,
		bubble:
			"border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-800 dark:text-stone-200 rounded-md",
	},
	system: {
		icon: <Cog className="h-3.5 w-3.5" />,
		label: "System",
		align: "items-start" as const,
		bubble:
			"bg-amber-50/70 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 rounded-md border border-amber-200 dark:border-amber-900",
	},
	tool: {
		icon: <Wrench className="h-3.5 w-3.5" />,
		label: "Tool Result",
		align: "items-start" as const,
		bubble:
			"bg-stone-50 dark:bg-stone-900/50 text-stone-800 dark:text-stone-200 rounded-md border border-stone-200 dark:border-stone-800",
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

	// 5. Deduplicate messages with identical role + content.
	//    In multi-step agent traces, each LLM call span carries the full
	//    conversation history in gen_ai.input.messages — so the same user
	//    prompt appears in every step. We keep only the first occurrence.
	//    Tool indicators, span indicators, thoughts, edits, and subagents
	//    are never deduped (they're unique actions).
	const seenMessages = new Set<string>();
	const dedupedItems = allItems.filter((item) => {
		if (item.type !== "message") return true; // keep all non-message items
		const key = `${item.role}::${item.content}`;
		if (seenMessages.has(key)) return false;
		seenMessages.add(key);
		return true;
	});

	// 6. Empty state
	if (dedupedItems.length === 0) {
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
		<div className="flex flex-col gap-2 py-2">
			{dedupedItems.map((item, i) => {
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

				// ── Thinking / reasoning text ──
				if (item.type === "thought") {
					return (
						<ThoughtIndicator
							key={`${item.span.SpanId}-thought-${i}`}
							item={item}
							isSelected={isSelected}
							onClick={() =>
								updateRequest({ spanId: item.span.SpanId })
							}
						/>
					);
				}

				// ── Edit decision ──
				if (item.type === "edit") {
					return (
						<EditIndicator
							key={`${item.span.SpanId}-edit-${i}`}
							item={item}
							isSelected={isSelected}
							onClick={() =>
								updateRequest({ spanId: item.span.SpanId })
							}
						/>
					);
				}

				// ── Subagent ──
				if (item.type === "subagent") {
					return (
						<SubagentIndicator
							key={`${item.span.SpanId}-subagent-${i}`}
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
							className={`mx-2 flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors ${
								isSelected
									? "border-primary/40 bg-primary/5"
									: "border-stone-200 bg-white hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900"
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
						className={`flex flex-col gap-0.5 px-2 ${config.align}`}
					>
						{/* Role label + span name */}
						<div
							className={`flex items-center gap-1.5 px-1 text-[10px] text-stone-400 dark:text-stone-500 ${
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
							className={`max-w-[92%] cursor-pointer whitespace-pre-wrap break-words px-2.5 py-2 text-[12px] leading-relaxed transition-colors ${
								config.bubble
							} ${
								isSelected
									? "ring-1 ring-primary/60"
									: "hover:border-stone-300 dark:hover:border-stone-700"
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
