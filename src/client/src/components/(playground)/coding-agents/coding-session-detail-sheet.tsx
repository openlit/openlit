"use client";

/**
 * Side-sheet drilldown for a single coding-agent session.
 *
 * Mirrors the request-detail drawer used on the monitoring tab, but
 * tailored for the coding-agent transcript shape: prompts, responses,
 * thoughts, tool calls (with args/results), edits, and subagents
 * arranged on a single time-ordered timeline.
 *
 * Body text is shown only when the operator opted into full content
 * capture at hook time. When prompts/responses are missing, the
 * timeline still renders the turn metadata (model, timestamps, token
 * counts) so users can see the shape of the session even in the
 * privacy-preserving mode.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Bot, User, Wrench, FilePen, GitBranch, Cpu, ExternalLink, Copy, Check } from "lucide-react";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import getMessage from "@/constants/messages";

interface CodingSessionDetailSheetProps {
	sessionId: string | null;
	onClose: () => void;
}

interface CodingSessionDetail {
	session_id: string;
	vendor: string;
	user: string;
	started_at: string;
	ended_at: string | null;
	duration_ms: number;
	tool_call_count: number;
	cost_usd: number;
	outcome: string;
	classification: string;
	classification_reason: string;
	repo_url: string;
	repo_dirty: boolean;
	model: string;
	branch: string;
	commit_sha: string;
	policy_permission_mode: string;
	content_capture_mode: string;
	tools: { tool_name: string; calls: number }[];
	mcp_servers: { server_name: string; calls: number }[];
	turns: TurnRow[];
	tool_calls: ToolCallRow[];
	edits: EditRow[];
	subagents: SubagentRow[];
}

interface TurnRow {
	timestamp: string;
	kind: string;
	model: string;
	prompt: string;
	response: string;
	thought: string;
	input_tokens: number;
	output_tokens: number;
	cost_usd: number;
	attachment_paths: string[];
}

interface ToolCallRow {
	timestamp: string;
	tool_name: string;
	tool_use_id: string;
	mcp_server_name: string;
	command: string;
	working_dir: string;
	args: string;
	result: string;
	duration_ms: number;
	errored: boolean;
	error_msg: string;
	failure_type: string;
	sandboxed: boolean;
}

interface EditRow {
	timestamp: string;
	file_path: string;
	decision: string;
	source: string;
	tool_name: string;
	lines_added: number;
	lines_removed: number;
	language: string;
}

interface SubagentRow {
	timestamp: string;
	subagent_type: string;
	task: string;
	summary: string;
	status: string;
	duration_ms: number;
	message_count: number;
	tool_call_count: number;
	modified_files: string[];
}

type TimelineItem =
	| { kind: "turn"; ts: number; data: TurnRow }
	| { kind: "tool"; ts: number; data: ToolCallRow }
	| { kind: "edit"; ts: number; data: EditRow }
	| { kind: "subagent"; ts: number; data: SubagentRow };

export default function CodingSessionDetailSheet({
	sessionId,
	onClose,
}: CodingSessionDetailSheetProps) {
	const [detail, setDetail] = useState<CodingSessionDetail | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!sessionId) {
			setDetail(null);
			setError(null);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const res = await fetch(
					`/api/coding-agents/sessions/${encodeURIComponent(sessionId)}`
				);
				if (cancelled) return;
				if (!res.ok) {
					setError(`HTTP ${res.status}`);
					setDetail(null);
					return;
				}
				const body = await res.json();
				setDetail(body.data || null);
			} catch (e) {
				if (!cancelled) setError(String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [sessionId]);

	const timeline = useMemo<TimelineItem[]>(() => {
		if (!detail) return [];
		const items: TimelineItem[] = [];
		for (const t of detail.turns)
			items.push({ kind: "turn", ts: parseTs(t.timestamp), data: t });
		for (const t of detail.tool_calls)
			items.push({ kind: "tool", ts: parseTs(t.timestamp), data: t });
		for (const e of detail.edits)
			items.push({ kind: "edit", ts: parseTs(e.timestamp), data: e });
		for (const s of detail.subagents)
			items.push({ kind: "subagent", ts: parseTs(s.timestamp), data: s });
		items.sort((a, b) => a.ts - b.ts);
		return items;
	}, [detail]);

	return (
		<Sheet open={Boolean(sessionId)} onOpenChange={(v) => !v && onClose()}>
			<SheetContent
				side="right"
				className="w-full sm:max-w-2xl overflow-y-auto p-0"
			>
				<SheetHeader className="px-6 py-4 border-b border-stone-200 dark:border-stone-800 sticky top-0 bg-background z-10">
					<SheetTitle className="text-lg flex items-center gap-2">
						<Cpu className="w-4 h-4 text-stone-500" />
						{getMessage().AGENTS_CODING_SESSION_DETAIL_TITLE}
					</SheetTitle>
					<SheetDescription className="font-mono text-xs">
						{sessionId}
					</SheetDescription>
				</SheetHeader>

				<div className="px-6 py-4 space-y-6">
					{loading && (
						<div className="flex items-center justify-center py-12 text-sm text-stone-500 gap-2">
							<Loader2 className="w-4 h-4 animate-spin" />
							{getMessage().AGENTS_LOADING_REQUESTS}
						</div>
					)}

					{error && (
						<div className="border border-red-200 dark:border-red-900/50 rounded-lg p-4 text-sm text-red-700 dark:text-red-400">
							{error}
						</div>
					)}

					{detail && !loading && (
						<>
							<HeaderCard detail={detail} />
							<TopBreakdowns detail={detail} />
							<TimelineSection items={timeline} />
						</>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}

function HeaderCard({ detail }: { detail: CodingSessionDetail }) {
	return (
		<div className="grid grid-cols-2 gap-3 text-sm">
			<KV label="Vendor" value={detail.vendor || "—"} />
			<KV label="User" value={detail.user || "—"} />
			<KV label="Model" value={detail.model || "—"} />
			<KV
				label="Duration"
				value={
					detail.duration_ms > 0
						? `${(detail.duration_ms / 1000).toFixed(1)}s`
						: "—"
				}
			/>
			<KV
				label="Cost"
				value={`$${(detail.cost_usd ?? 0).toFixed(4)}`}
			/>
			<KV label="Outcome" value={detail.outcome || "—"} />
			<KV
				label="Classification"
				value={`${detail.classification}${
					detail.classification_reason
						? ` (${detail.classification_reason})`
						: ""
				}`}
			/>
			<KV
				label="Permission mode"
				value={detail.policy_permission_mode || "unknown"}
			/>
			{detail.repo_url && (
				<KV
					label="Repo"
					value={
						<span className="inline-flex items-center gap-1">
							<GitBranch className="w-3 h-3" />
							<span className="truncate" title={detail.repo_url}>
								{detail.repo_url.replace(/\.git$/, "").split("/").slice(-2).join("/")}
							</span>
							{detail.branch ? (
								<span className="text-stone-400">@ {detail.branch}</span>
							) : null}
						</span>
					}
				/>
			)}
			<KV
				label="Tool calls"
				value={detail.tool_call_count.toLocaleString()}
			/>
		</div>
	);
}

function TopBreakdowns({ detail }: { detail: CodingSessionDetail }) {
	if (!detail.tools.length && !detail.mcp_servers.length) return null;
	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
			{detail.tools.length > 0 && (
				<div className="border dark:border-stone-800 rounded-lg p-3">
					<div className="text-xs font-medium uppercase text-stone-500 mb-2">
						Tools
					</div>
					<ul className="space-y-1 text-sm">
						{detail.tools.slice(0, 8).map((t) => (
							<li
								key={t.tool_name}
								className="flex items-center justify-between"
							>
								<span className="font-mono text-xs truncate">
									{t.tool_name}
								</span>
								<span className="text-stone-500 tabular-nums">
									{t.calls}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
			{detail.mcp_servers.length > 0 && (
				<div className="border dark:border-stone-800 rounded-lg p-3">
					<div className="text-xs font-medium uppercase text-stone-500 mb-2">
						MCP servers
					</div>
					<ul className="space-y-1 text-sm">
						{detail.mcp_servers.slice(0, 8).map((m) => (
							<li
								key={m.server_name}
								className="flex items-center justify-between"
							>
								<span className="font-mono text-xs truncate">
									{m.server_name}
								</span>
								<span className="text-stone-500 tabular-nums">
									{m.calls}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function TimelineSection({ items }: { items: TimelineItem[] }) {
	if (items.length === 0) {
		return (
			<div className="border dark:border-stone-800 rounded-lg p-4 text-sm text-stone-500">
				{getMessage().AGENTS_CODING_SESSION_DETAIL_EMPTY}
			</div>
		);
	}
	return (
		<div>
			<div className="text-xs font-medium uppercase text-stone-500 mb-2">
				Timeline ({items.length})
			</div>
			<ol className="space-y-3">
				{items.map((item, idx) => (
					<TimelineRow key={`${item.kind}-${idx}-${item.ts}`} item={item} />
				))}
			</ol>
		</div>
	);
}

function TimelineRow({ item }: { item: TimelineItem }) {
	switch (item.kind) {
		case "turn":
			return <TurnRowView turn={item.data} />;
		case "tool":
			return <ToolCallRowView call={item.data} />;
		case "edit":
			return <EditRowView edit={item.data} />;
		case "subagent":
			return <SubagentRowView sub={item.data} />;
	}
}

function TurnRowView({ turn }: { turn: TurnRow }) {
	const isAssistant = turn.kind === "assistant_only";
	const isThought = turn.kind === "thought" || (!turn.prompt && !turn.response && turn.thought);

	return (
		<li className="border dark:border-stone-800 rounded-lg p-3 space-y-2">
			<div className="flex items-center justify-between gap-2 text-xs">
				<div className="flex items-center gap-2">
					{isThought ? (
						<Cpu className="w-3.5 h-3.5 text-purple-500" />
					) : isAssistant ? (
						<Bot className="w-3.5 h-3.5 text-emerald-600" />
					) : (
						<User className="w-3.5 h-3.5 text-blue-600" />
					)}
					<span className="font-medium uppercase tracking-wide">
						{isThought
							? "thought"
							: isAssistant
								? "assistant"
								: "user"}
					</span>
					{turn.model ? (
						<Badge variant="secondary" className="font-mono text-[10px]">
							{turn.model}
						</Badge>
					) : null}
				</div>
				<div className="text-stone-500 tabular-nums">
					{formatTime(turn.timestamp)}
					{turn.input_tokens > 0 ? (
						<span className="ml-2">↓{turn.input_tokens.toLocaleString()}</span>
					) : null}
					{turn.output_tokens > 0 ? (
						<span className="ml-2">↑{turn.output_tokens.toLocaleString()}</span>
					) : null}
					{turn.cost_usd > 0 ? (
						<span className="ml-2">
							${turn.cost_usd.toFixed(4)}
						</span>
					) : null}
				</div>
			</div>
			{turn.attachment_paths.length > 0 && (
				<div className="text-[11px] text-stone-500 flex flex-wrap gap-1">
					{turn.attachment_paths.map((p) => (
						<Badge variant="outline" key={p} className="font-mono">
							{p}
						</Badge>
					))}
				</div>
			)}
			{turn.prompt ? <ExpandableText label="Prompt" text={turn.prompt} /> : null}
			{turn.response ? (
				<ExpandableText label="Response" text={turn.response} />
			) : null}
			{turn.thought ? (
				<ExpandableText label="Thought" text={turn.thought} muted />
			) : null}
			{!turn.prompt && !turn.response && !turn.thought && (
				<div className="text-xs text-stone-500 italic">
					Body suppressed (content capture is metadata-only)
				</div>
			)}
		</li>
	);
}

function ToolCallRowView({ call }: { call: ToolCallRow }) {
	return (
		<li
			className={`border rounded-lg p-3 space-y-2 ${
				call.errored
					? "border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/10"
					: "dark:border-stone-800"
			}`}
		>
			<div className="flex items-center justify-between gap-2 text-xs">
				<div className="flex items-center gap-2">
					<Wrench className="w-3.5 h-3.5 text-amber-600" />
					<span className="font-mono font-medium">{call.tool_name}</span>
					{call.mcp_server_name ? (
						<Badge variant="outline" className="text-[10px]">
							MCP · {call.mcp_server_name}
						</Badge>
					) : null}
					{call.errored ? (
						<Badge variant="destructive" className="text-[10px]">
							{call.failure_type || "error"}
						</Badge>
					) : null}
					{call.sandboxed ? (
						<Badge variant="secondary" className="text-[10px]">
							sandboxed
						</Badge>
					) : null}
				</div>
				<div className="text-stone-500 tabular-nums">
					{formatTime(call.timestamp)}
					{call.duration_ms > 0 ? (
						<span className="ml-2">
							{(call.duration_ms / 1000).toFixed(2)}s
						</span>
					) : null}
				</div>
			</div>
			{call.command ? (
				<pre className="text-xs bg-stone-50 dark:bg-stone-900/40 rounded p-2 overflow-x-auto font-mono">
					$ {call.command}
				</pre>
			) : null}
			{call.args ? <ExpandableText label="Input" text={call.args} /> : null}
			{call.result ? (
				<ExpandableText label="Output" text={call.result} />
			) : null}
			{call.error_msg ? (
				<ExpandableText label="Error" text={call.error_msg} muted />
			) : null}
		</li>
	);
}

function EditRowView({ edit }: { edit: EditRow }) {
	return (
		<li className="border dark:border-stone-800 rounded-lg p-3">
			<div className="flex items-center justify-between gap-2 text-xs">
				<div className="flex items-center gap-2">
					<FilePen className="w-3.5 h-3.5 text-orange-500" />
					<span className="font-mono truncate" title={edit.file_path}>
						{edit.file_path || "(no path)"}
					</span>
					<Badge variant="outline" className="text-[10px]">
						{edit.decision}
					</Badge>
				</div>
				<div className="text-stone-500 tabular-nums whitespace-nowrap">
					{edit.lines_added > 0 ? (
						<span className="text-emerald-600">+{edit.lines_added}</span>
					) : null}
					{edit.lines_removed > 0 ? (
						<span className="ml-2 text-red-500">-{edit.lines_removed}</span>
					) : null}
					<span className="ml-3">{formatTime(edit.timestamp)}</span>
				</div>
			</div>
		</li>
	);
}

function SubagentRowView({ sub }: { sub: SubagentRow }) {
	return (
		<li className="border dark:border-stone-800 rounded-lg p-3 space-y-2">
			<div className="flex items-center justify-between gap-2 text-xs">
				<div className="flex items-center gap-2">
					<Bot className="w-3.5 h-3.5 text-violet-600" />
					<span className="font-medium">subagent · {sub.subagent_type || "?"}</span>
					<Badge
						variant={sub.status === "completed" ? "default" : "outline"}
						className="text-[10px]"
					>
						{sub.status}
					</Badge>
				</div>
				<div className="text-stone-500 tabular-nums">
					{formatTime(sub.timestamp)}
					{sub.duration_ms > 0 ? (
						<span className="ml-2">{(sub.duration_ms / 1000).toFixed(1)}s</span>
					) : null}
				</div>
			</div>
			{sub.task ? (
				<div className="text-xs text-stone-700 dark:text-stone-300">
					<span className="text-stone-500">Task: </span>
					{sub.task}
				</div>
			) : null}
			{sub.summary ? (
				<ExpandableText label="Summary" text={sub.summary} muted />
			) : null}
			{sub.modified_files.length > 0 ? (
				<div className="text-[11px] text-stone-500">
					Modified {sub.modified_files.length} file
					{sub.modified_files.length === 1 ? "" : "s"}
				</div>
			) : null}
		</li>
	);
}

function KV({
	label,
	value,
}: {
	label: string;
	value: React.ReactNode;
}) {
	return (
		<div>
			<div className="text-[11px] uppercase text-stone-500 tracking-wide mb-0.5">
				{label}
			</div>
			<div className="text-stone-800 dark:text-stone-200 truncate">{value}</div>
		</div>
	);
}

function ExpandableText({
	label,
	text,
	muted,
}: {
	label: string;
	text: string;
	muted?: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const [copied, setCopied] = useState(false);
	const limit = 600;
	const tooLong = text.length > limit;
	const display = expanded || !tooLong ? text : text.slice(0, limit);

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// noop
		}
	};

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between text-[10px] uppercase tracking-wide">
				<span className={muted ? "text-stone-400" : "text-stone-500"}>
					{label}
				</span>
				<button
					type="button"
					onClick={onCopy}
					className="inline-flex items-center gap-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
				>
					{copied ? (
						<Check className="w-3 h-3 text-emerald-500" />
					) : (
						<Copy className="w-3 h-3" />
					)}
				</button>
			</div>
			<pre
				className={`text-xs whitespace-pre-wrap break-words rounded p-2 font-mono leading-relaxed ${
					muted
						? "bg-stone-50/40 dark:bg-stone-900/20 text-stone-500"
						: "bg-stone-50 dark:bg-stone-900/40 text-stone-800 dark:text-stone-200"
				}`}
			>
				{display}
				{tooLong && !expanded ? "…" : ""}
			</pre>
			{tooLong ? (
				<button
					type="button"
					className="text-[11px] text-primary hover:underline"
					onClick={() => setExpanded((v) => !v)}
				>
					{expanded ? "Show less" : `Show ${text.length - limit} more chars`}
				</button>
			) : null}
		</div>
	);
}

function parseTs(s: string): number {
	const n = Date.parse(s);
	return Number.isFinite(n) ? n : 0;
}

function formatTime(s: string): string {
	const n = Date.parse(s);
	if (!Number.isFinite(n)) return s;
	const d = new Date(n);
	return d.toLocaleTimeString();
}

// Re-export the icon button used by parent so it can render inline
// without importing lucide directly.
export { ExternalLink };
