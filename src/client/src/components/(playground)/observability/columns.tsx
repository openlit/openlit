import { Columns } from "@/components/data-table/columns";
import { CalendarDays } from "lucide-react";
import { format } from "date-fns";
import getMessage from "@/constants/messages";

const m = getMessage();

export type CodingAgentSessionRowView = {
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
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
	trace_id: string;
	session_root_span_id: string;
	permission_mode: string;
	working_dir: string;
	working_dir_label: string;
	// Per-session code-change rollups. Mirrors CodingAgentSessionRow
	// from queries.ts. `acceptance_pct` is computed server-side from
	// accept / (accept + reject) so the cell renders directly.
	lines_added: number;
	lines_removed: number;
	lines_accepted: number;
	lines_rejected: number;
	edit_accept_count: number;
	edit_reject_count: number;
	acceptance_pct: number;
	commit_count: number;
	pr_count: number;
};

export type CodingAgentUserRowView = {
	user: string;
	last_seen: string;
	session_count: number;
	tool_call_count: number;
	cost_usd: number;
	total_tokens: number;
	top_vendor: string;
	classification_work: number;
	classification_personal: number;
	// Per-user code-impact rollups. Same dual-source shape the
	// per-session list uses; precomputed `acceptance_pct` is over
	// edit decisions, NOT lines.
	lines_added: number;
	lines_accepted: number;
	lines_rejected: number;
	acceptance_pct: number;
	commit_count: number;
	pr_count: number;
};

export type LogRow = {
	rowId: string | number;
	Timestamp: string;
	TraceId: string;
	SpanId: string;
	SeverityText: string;
	ServiceName: string;
	Body: string;
};

export type MetricRow = {
	metricName: string;
	metricType: string;
	serviceName: string;
	metricUnit?: string;
	latestValue?: number;
	avgValue?: number;
	minValue?: number;
	maxValue?: number;
	pointCount: number;
	lastSeen: string;
};

function formatDate(value?: string) {
	if (!value) return "-";
	try {
		return format(new Date(value), "MMM d, HH:mm:ss");
	} catch {
		return value;
	}
}

export const logColumns: Columns<string, LogRow> = {
	time: {
		header: () => m.OBSERVABILITY_TIME,
		cell: ({ row }) => (
			<div className="flex space-x-2 items-center" title={row.Timestamp}>
				<CalendarDays size="16" />
				<span className="truncate font-medium">{formatDate(row.Timestamp)}</span>
			</div>
		),
		enableHiding: true,
	},
	severityText: {
		header: () => m.OBSERVABILITY_SEVERITY,
		cell: ({ row }) => (
			<span className="truncate" title={row.SeverityText || "-"}>
				{row.SeverityText || "-"}
			</span>
		),
		enableHiding: true,
	},
	serviceName: {
		header: () => m.OBSERVABILITY_SERVICE,
		cell: ({ row }) => (
			<div className="truncate" title={row.ServiceName}>
				{row.ServiceName || "-"}
			</div>
		),
		enableHiding: true,
	},
	body: {
		header: () => m.OBSERVABILITY_BODY,
		cell: ({ row }) => (
			<div className="truncate" title={row.Body}>
				{row.Body || "-"}
			</div>
		),
		enableHiding: true,
	},
	traceId: {
		header: () => m.OBSERVABILITY_TRACE_ID,
		cell: ({ row }) => (
			<div className="truncate font-mono text-xs" title={row.TraceId}>
				{row.TraceId || "-"}
			</div>
		),
		enableHiding: true,
	},
	spanId: {
		header: () => m.OBSERVABILITY_SPAN_ID,
		cell: ({ row }) => (
			<div className="truncate font-mono text-xs" title={row.SpanId}>
				{row.SpanId || "-"}
			</div>
		),
		enableHiding: true,
	},
};

export const metricColumns: Columns<string, MetricRow> = {
	metricName: {
		header: () => m.OBSERVABILITY_METRIC,
		cell: ({ row }) => (
			<div className="truncate font-medium" title={row.metricName}>
				{row.metricName}
			</div>
		),
		enableHiding: true,
	},
	metricType: {
		header: () => m.OBSERVABILITY_TYPE,
		cell: ({ row }) => <span className="truncate">{row.metricType}</span>,
		enableHiding: true,
	},
	serviceName: {
		header: () => m.OBSERVABILITY_SERVICE,
		cell: ({ row }) => (
			<div className="truncate" title={row.serviceName}>
				{row.serviceName || "-"}
			</div>
		),
		enableHiding: true,
	},
	metricUnit: {
		header: () => m.OBSERVABILITY_UNIT,
		cell: ({ row }) => <span className="truncate">{row.metricUnit || "-"}</span>,
		enableHiding: true,
	},
	latestValue: {
		header: () => m.OBSERVABILITY_LATEST,
		cell: ({ row }) => (
			<span className="tabular-nums">
				{typeof row.latestValue === "number" ? row.latestValue.toFixed(4) : "-"}
			</span>
		),
		enableHiding: true,
	},
	pointCount: {
		header: () => m.OBSERVABILITY_POINTS,
		cell: ({ row }) => (
			<span className="tabular-nums">{row.pointCount?.toLocaleString()}</span>
		),
		enableHiding: true,
	},
	lastSeen: {
		header: () => m.OBSERVABILITY_LAST_SEEN,
		cell: ({ row }) => (
			<div className="flex space-x-2 items-center" title={row.lastSeen}>
				<CalendarDays size="16" />
				<span className="truncate font-medium">{formatDate(row.lastSeen)}</span>
			</div>
		),
		enableHiding: true,
	},
};

function durationLabel(ms: number) {
	if (!Number.isFinite(ms) || ms <= 0) return "—";
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	const sec = ms / 1000;
	if (sec < 60) return `${sec.toFixed(1)}s`;
	const min = sec / 60;
	if (min < 60) return `${min.toFixed(1)}m`;
	return `${(min / 60).toFixed(1)}h`;
}

const OUTCOME_TONE: Record<string, string> = {
	merged:
		"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
	committed:
		"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
	abandoned_with_change:
		"bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

const CLASSIFICATION_TONE: Record<string, string> = {
	work: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
	personal:
		"bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
	disputed: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

function pillClass(map: Record<string, string>, key: string) {
	return (
		map[key] ||
		"bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
	);
}

export const sessionsColumns: Columns<string, CodingAgentSessionRowView> = {
	session: {
		header: () => m.AGENTS_CODING_SESSIONS_SESSION,
		cell: ({ row }) => {
			const title =
				row.vendor && row.session_id
					? `${row.vendor} session`
					: "untitled session";
			const shortId = row.session_id ? row.session_id.slice(0, 8) : "—";
			return (
				<div className="min-w-0">
					<div className="truncate text-xs font-medium text-stone-900 dark:text-stone-100" title={row.session_id}>
						{title}
					</div>
					<div
						className="truncate font-mono text-[10px] text-stone-500 dark:text-stone-400"
						title={row.session_id}
					>
						{shortId}
					</div>
				</div>
			);
		},
		enableHiding: true,
	},
	user: {
		header: () => m.AGENTS_CODING_SESSIONS_USER,
		cell: ({ row }) => (
			<div className="truncate" title={row.user || ""}>
				{row.user || "—"}
			</div>
		),
		enableHiding: true,
	},
	started: {
		header: () => m.AGENTS_CODING_SESSIONS_STARTED,
		cell: ({ row }) => (
			<div
				className="flex items-center gap-2 truncate"
				title={row.started_at || ""}
			>
				<CalendarDays size="14" />
				<span className="truncate">{formatDate(row.started_at)}</span>
			</div>
		),
		enableHiding: true,
	},
	duration: {
		header: () => m.AGENTS_CODING_SESSIONS_DURATION,
		cell: ({ row }) => (
			<span className="tabular-nums">{durationLabel(row.duration_ms)}</span>
		),
		enableHiding: true,
	},
	model: {
		header: () => "Model",
		cell: ({ row }) => (
			<div className="truncate font-mono text-xs" title={row.model || ""}>
				{row.model || "—"}
			</div>
		),
		enableHiding: true,
	},
	tools: {
		header: () => m.AGENTS_CODING_SESSIONS_TOOLS,
		cell: ({ row }) => (
			<span className="tabular-nums">
				{(row.tool_call_count ?? 0).toLocaleString()}
			</span>
		),
		enableHiding: true,
	},
	// Code-impact: shows added / removed (with rejected lines as
	// tooltip) so a reviewer can scan the Sessions list and spot
	// outliers without opening each session.
	code: {
		header: () => m.AGENTS_CODING_SESSIONS_CODE,
		cell: ({ row }) => {
			const added = row.lines_added ?? 0;
			const removed = row.lines_removed ?? 0;
			const accepted = row.lines_accepted ?? 0;
			const rejected = row.lines_rejected ?? 0;
			const tooltip = `+${added} added · −${removed} removed · ${accepted} accepted · ${rejected} rejected`;
			if (!added && !removed) {
				return <span className="text-stone-400">—</span>;
			}
			return (
				<span className="text-xs tabular-nums" title={tooltip}>
					<span className="text-emerald-600 dark:text-emerald-400">
						+{added.toLocaleString()}
					</span>
					<span className="mx-1 text-stone-400">/</span>
					<span className="text-rose-600 dark:text-rose-400">
						−{removed.toLocaleString()}
					</span>
				</span>
			);
		},
		enableHiding: true,
	},
	acceptance: {
		header: () => m.AGENTS_CODING_SESSIONS_ACCEPTANCE,
		cell: ({ row }) => {
			const accepts = row.edit_accept_count ?? 0;
			const rejects = row.edit_reject_count ?? 0;
			const total = accepts + rejects;
			if (!total) return <span className="text-stone-400">—</span>;
			return (
				<span
					className="text-xs tabular-nums"
					title={`${accepts} accepted · ${rejects} rejected of ${total} decisions`}
				>
					{Math.round(row.acceptance_pct ?? 0)}%
				</span>
			);
		},
		enableHiding: true,
	},
	commits: {
		header: () => m.AGENTS_CODING_SESSIONS_COMMITS,
		cell: ({ row }) => (
			<span className="tabular-nums">
				{(row.commit_count ?? 0).toLocaleString()}
			</span>
		),
		enableHiding: true,
	},
	prs: {
		header: () => m.AGENTS_CODING_SESSIONS_PRS,
		cell: ({ row }) => (
			<span className="tabular-nums">
				{(row.pr_count ?? 0).toLocaleString()}
			</span>
		),
		enableHiding: true,
	},
	tokens: {
		header: () => "Tokens",
		cell: ({ row }) => {
			const total =
				Number(row.total_tokens || 0) ||
				Number(row.input_tokens || 0) + Number(row.output_tokens || 0);
			return (
				<span
					className="tabular-nums"
					title={`in ${row.input_tokens ?? 0} / out ${row.output_tokens ?? 0}`}
				>
					{total > 0 ? total.toLocaleString() : "—"}
				</span>
			);
		},
		enableHiding: true,
	},
	cost: {
		header: () => m.AGENTS_CODING_SESSIONS_COST,
		cell: ({ row }) => (
			<span className="tabular-nums">${(row.cost_usd ?? 0).toFixed(4)}</span>
		),
		enableHiding: true,
	},
	outcome: {
		header: () => m.AGENTS_CODING_SESSIONS_OUTCOME,
		cell: ({ row }) => (
			<span
				className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${pillClass(
					OUTCOME_TONE,
					row.outcome
				)}`}
			>
				{row.outcome || "—"}
			</span>
		),
		enableHiding: true,
	},
	classification: {
		header: () => m.AGENTS_CODING_SESSIONS_CLASSIFICATION,
		cell: ({ row }) => (
			<span
				className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${pillClass(
					CLASSIFICATION_TONE,
					row.classification
				)}`}
				title={row.classification_reason || row.classification}
			>
				{row.classification || "unknown"}
			</span>
		),
		enableHiding: true,
	},
};

export const codingUsersColumns: Columns<string, CodingAgentUserRowView> = {
	user: {
		header: () => m.AGENTS_CODING_SESSIONS_USER,
		cell: ({ row }) => (
			<div className="truncate font-mono" title={row.user || ""}>
				{row.user || "—"}
			</div>
		),
		enableHiding: true,
	},
	sessions: {
		header: () => m.AGENTS_CODING_SESSIONS_SESSION,
		cell: ({ row }) => (
			<span className="tabular-nums">
				{(row.session_count ?? 0).toLocaleString()}
			</span>
		),
		enableHiding: true,
	},
	tools: {
		header: () => m.AGENTS_CODING_SESSIONS_TOOLS,
		cell: ({ row }) => (
			<span className="tabular-nums">
				{(row.tool_call_count ?? 0).toLocaleString()}
			</span>
		),
		enableHiding: true,
	},
	cost: {
		header: () => m.AGENTS_CODING_SESSIONS_COST,
		cell: ({ row }) => (
			<span className="tabular-nums">${(row.cost_usd ?? 0).toFixed(4)}</span>
		),
		enableHiding: true,
	},
	tokens: {
		header: () => "Tokens",
		cell: ({ row }) => (
			<span className="tabular-nums">
				{(row.total_tokens ?? 0).toLocaleString()}
			</span>
		),
		enableHiding: true,
	},
	lines: {
		header: () => m.AGENTS_CODING_USERS_LINES,
		cell: ({ row }) => {
			const added = row.lines_added ?? 0;
			if (!added) return <span className="text-stone-400">—</span>;
			return (
				<span
					className="text-xs tabular-nums text-emerald-600 dark:text-emerald-400"
					title={`${row.lines_accepted ?? 0} accepted · ${row.lines_rejected ?? 0} rejected`}
				>
					+{added.toLocaleString()}
				</span>
			);
		},
		enableHiding: true,
	},
	acceptance: {
		header: () => m.AGENTS_CODING_USERS_ACCEPTANCE,
		cell: ({ row }) => {
			const accepts = row.acceptance_pct ?? 0;
			if (!row.lines_accepted && !row.lines_rejected) {
				return <span className="text-stone-400">—</span>;
			}
			return (
				<span className="text-xs tabular-nums">
					{Math.round(accepts)}%
				</span>
			);
		},
		enableHiding: true,
	},
	commits: {
		header: () => m.AGENTS_CODING_USERS_COMMITS,
		cell: ({ row }) => (
			<span className="tabular-nums">
				{(row.commit_count ?? 0).toLocaleString()}
			</span>
		),
		enableHiding: true,
	},
	prs: {
		header: () => m.AGENTS_CODING_USERS_PRS,
		cell: ({ row }) => (
			<span className="tabular-nums">
				{(row.pr_count ?? 0).toLocaleString()}
			</span>
		),
		enableHiding: true,
	},
	topVendor: {
		header: () => "Top vendor",
		cell: ({ row }) => (
			<div className="truncate" title={row.top_vendor || ""}>
				{row.top_vendor || "—"}
			</div>
		),
		enableHiding: true,
	},
	mix: {
		header: () => "Work / personal",
		cell: ({ row }) => {
			const total = Math.max(
				1,
				(row.classification_work ?? 0) + (row.classification_personal ?? 0)
			);
			const workPct = ((row.classification_work ?? 0) / total) * 100;
			return (
				<div className="flex items-center gap-2 min-w-[120px]">
					<div className="h-1.5 flex-1 overflow-hidden rounded bg-stone-100 dark:bg-stone-800">
						<div
							className="h-full bg-blue-500"
							style={{ width: `${workPct}%` }}
						/>
					</div>
					<span className="tabular-nums text-xs text-stone-600 dark:text-stone-400">
						{Math.round(workPct)}%
					</span>
				</div>
			);
		},
		enableHiding: true,
	},
	lastSeen: {
		header: () => m.OBSERVABILITY_LAST_SEEN,
		cell: ({ row }) => (
			<div
				className="flex items-center gap-2 truncate"
				title={row.last_seen || ""}
			>
				<CalendarDays size="14" />
				<span className="truncate">{formatDate(row.last_seen)}</span>
			</div>
		),
		enableHiding: true,
	},
};
