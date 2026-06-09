"use client";

import { format } from "date-fns";
import {
	BarChart3,
	Bot,
	Clock,
	DollarSign,
	Folder,
	GitBranch,
	Hash,
	Info,
	Wrench,
	Zap,
} from "lucide-react";
import { ObservabilitySignalConfig } from "./registry";
import {
	CodingAgentVendorIcon,
	hasCodingAgentVendorIcon,
} from "@/components/svg/coding-agents";
import getMessage from "@/constants/messages";

const m = getMessage();

function formatDate(value?: string) {
	if (!value) return "-";
	try {
		return format(new Date(value), "MMM d, HH:mm:ss");
	} catch {
		return value;
	}
}

function attrValue(
	source: Record<string, any> | undefined,
	keys: string[]
) {
	for (const key of keys) {
		const value = source?.[key];
		if (value !== undefined && value !== null && String(value).length > 0) {
			return String(value);
		}
	}
	return "";
}

function compactText(value?: string, size = 12) {
	if (!value) return "-";
	return value.length > size ? `${value.slice(0, size)}...` : value;
}

function topAttributePairs(
	sources: Array<Record<string, any> | undefined>,
	limit = 3
) {
	const preferred = [
		"event.name",
		"log.iostream",
		"thread.name",
		"process.pid",
		"http.route",
		"url.path",
		"rpc.method",
		"db.system",
		"messaging.operation",
		"k8s.namespace.name",
		"k8s.deployment.name",
		"telemetry.sdk.name",
	];
	const pairs: Array<[string, string]> = [];
	const pushPair = (key: string, value: unknown) => {
		if (pairs.length >= limit || value == null || String(value).length === 0) return;
		if (pairs.some(([existing]) => existing === key)) return;
		pairs.push([key, String(value)]);
	};

	for (const key of preferred) {
		for (const source of sources) {
			pushPair(key, source?.[key]);
		}
	}
	for (const source of sources) {
		for (const [key, value] of Object.entries(source || {})) {
			pushPair(key, value);
			if (pairs.length >= limit) break;
		}
		if (pairs.length >= limit) break;
	}
	return pairs;
}

function MiniMeta({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode;
	label: string;
	value?: string | number;
}) {
	return (
		<span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
			{icon}
			<span className="text-stone-400 dark:text-stone-500">{label}</span>
			<span className="truncate font-medium tabular-nums text-stone-900 dark:text-stone-100">
				{value || "-"}
			</span>
		</span>
	);
}

function TraceRecord({
	row,
	config,
	visibilityColumns,
	isSelected,
	onOpen,
}: {
	row: any;
	config: ObservabilitySignalConfig;
	visibilityColumns: Record<string, boolean>;
	isSelected?: boolean;
	onOpen: (row: any) => void;
}) {
	const show = (key: string) => visibilityColumns[key] !== false;
	return (
		<button
			type="button"
			onClick={() => onOpen(row)}
			className={`group w-full rounded-md border p-3 text-left transition ${
				isSelected
					? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/20 dark:border-primary dark:bg-primary/15"
					: "border-stone-200 bg-white hover:border-primary/50 hover:bg-primary/5 dark:border-stone-800 dark:bg-stone-950 dark:hover:border-primary/60 dark:hover:bg-primary/10"
			}`}
		>
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-2">
						<span className={`h-2 w-2 rounded-full ${config.key === "exceptions" ? "bg-rose-500" : "bg-sky-500"}`} />
						<h3 className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
							{show("spanName") ? row.spanName || row.id : row.id}
						</h3>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
						{show("time") && <span>{row.time}</span>}
						{show("id") && <span className="font-mono">{row.spanId}</span>}
						{show("serviceName") && row.serviceName && <span>{row.serviceName}</span>}
					</div>
				</div>
				<div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:justify-end">
					{show("requestDuration") && <MiniMeta icon={<Clock className="h-3.5 w-3.5" />} label="duration" value={`${parseFloat(row.requestDuration || "0").toFixed(3)}s`} />}
					{show("totalTokens") && <MiniMeta icon={<Zap className="h-3.5 w-3.5" />} label="tokens" value={row.totalTokens} />}
					{show("model") && <MiniMeta icon={<Hash className="h-3.5 w-3.5" />} label="model" value={row.model || row.system} />}
				</div>
			</div>
		</button>
	);
}

function LogRecord({
	row,
	visibilityColumns,
	isSelected,
	onOpen,
}: {
	row: any;
	visibilityColumns: Record<string, boolean>;
	isSelected?: boolean;
	onOpen: (row: any) => void;
}) {
	const show = (key: string) => visibilityColumns[key] !== false;
	const severity = String(row.SeverityText || "INFO");
	const normalizedSeverity = severity.toLowerCase();
	const isError = ["error", "fatal"].includes(normalizedSeverity);
	const isWarn = ["warn", "warning"].includes(normalizedSeverity);
	const severityClass = isError
		? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
		: isWarn
			? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
			: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300";
	const logAttrCount = row.LogAttributes ? Object.keys(row.LogAttributes).length : 0;
	const resourceAttrCount = row.ResourceAttributes ? Object.keys(row.ResourceAttributes).length : 0;
	const scopeAttrCount = row.ScopeAttributes ? Object.keys(row.ScopeAttributes).length : 0;
	const resourceAttrs = row.ResourceAttributes || {};
	const logAttrs = row.LogAttributes || {};
	const env = attrValue(resourceAttrs, ["deployment.environment", "service.namespace", "telemetry.sdk.language"]);
	const host = attrValue(resourceAttrs, ["host.name", "container.name", "k8s.pod.name"]);
	const http = [
		attrValue(logAttrs, ["http.request.method", "http.method"]),
		attrValue(logAttrs, ["http.response.status_code", "http.status_code"]),
	].filter(Boolean).join(" ");
	const exceptionType = attrValue(logAttrs, ["exception.type", "error.type"]);
	const exceptionMessage = attrValue(logAttrs, ["exception.message", "error.message"]);
	const codeLocation = [
		attrValue(logAttrs, ["code.function"]),
		attrValue(logAttrs, ["code.filepath"]),
		attrValue(logAttrs, ["code.lineno"]),
	].filter(Boolean).join(":");
	const primaryContext = exceptionType || http || codeLocation || env || host || row.ScopeName;
	const fallbackPairs = topAttributePairs([logAttrs, resourceAttrs, row.ScopeAttributes], 3);

	return (
		<button
			type="button"
			onClick={() => onOpen(row)}
			className={`w-full rounded-md border bg-white font-mono text-left transition dark:bg-stone-950 ${
				isSelected
					? "border-amber-500 bg-amber-50 shadow-sm ring-1 ring-amber-200 dark:border-amber-500 dark:bg-amber-950/20 dark:ring-amber-900"
					: "border-stone-200 hover:border-amber-400 hover:bg-amber-50/50 dark:border-stone-800 dark:hover:border-amber-700 dark:hover:bg-amber-950/10"
			}`}
		>
			<div className="flex w-full items-center gap-2 px-3 py-2">
				<div className="grid min-w-0 grow grid-cols-[auto_auto_auto_1fr] items-center gap-2">
					{show("severityText") && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${severityClass}`}>
						{severity}
					</span>}
					{show("time") && <span className="whitespace-nowrap text-xs text-stone-500 dark:text-stone-400">
						{formatDate(row.Timestamp)}
					</span>}
					{show("serviceName") && <span className="max-w-36 truncate text-xs text-stone-500 dark:text-stone-400">
						{row.ServiceName || "unknown service"}
					</span>}
					{show("body") && <p className="truncate text-sm text-stone-900 dark:text-stone-100">
						{row.Body || "-"}
					</p>}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-stone-100 px-3 py-1.5 text-[11px] text-stone-500 dark:border-stone-900 dark:text-stone-400">
				<span>sev#{row.SeverityNumber || "-"}</span>
				{primaryContext && <span title={primaryContext}>ctx:{compactText(primaryContext, 28)}</span>}
				{exceptionMessage && <span title={exceptionMessage}>msg:{compactText(exceptionMessage, 32)}</span>}
				{show("traceId") && <span className="font-mono" title={row.TraceId}>trace:{compactText(row.TraceId, 10)}</span>}
				{show("spanId") && <span className="font-mono" title={row.SpanId}>span:{compactText(row.SpanId, 10)}</span>}
				{host && <span title={host}>host:{compactText(host, 18)}</span>}
				{env && <span title={env}>env:{compactText(env, 18)}</span>}
				{fallbackPairs.map(([key, value]) => (
					<span key={`${key}-${value}`} title={`${key}: ${value}`}>
						{compactText(key, 16)}:{compactText(value, 20)}
					</span>
				))}
				<span>attrs:{logAttrCount}/{resourceAttrCount}/{scopeAttrCount}</span>
			</div>
		</button>
	);
}

function MetricRecord({
	row,
	visibilityColumns,
	isSelected,
	onOpen,
}: {
	row: any;
	visibilityColumns: Record<string, boolean>;
	isSelected?: boolean;
	onOpen: (row: any) => void;
}) {
	const show = (key: string) => visibilityColumns[key] !== false;
	const value = typeof row.latestValue === "number" ? row.latestValue : Number(row.latestValue || 0);
	const maxValue = Math.abs(Number(row.maxValue || 0));
	const minValue = Number(row.minValue || 0);
	const avgValue = Number(row.avgValue || 0);
	const observationCount = Number(row.observationCount || 0);
	const width = `${Math.max(8, Math.min(100, maxValue > 0 ? (Math.abs(value) / maxValue) * 100 : 0))}%`;
	const unit = row.metricUnit || "unitless";

	return (
		<button
			type="button"
			onClick={() => onOpen(row)}
			className={`group w-full rounded-md border p-3 text-left transition ${
				isSelected
					? "border-emerald-500 bg-emerald-50 shadow-sm ring-1 ring-emerald-200 dark:border-emerald-500 dark:bg-emerald-950/30 dark:ring-emerald-900"
					: "border-stone-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/60 dark:border-stone-800 dark:bg-stone-950 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/20"
			}`}
		>
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-2">
						<span className="h-2 w-2 rounded-full bg-emerald-500" />
						<h3 className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
							{show("metricName") ? row.metricName : m.OBSERVABILITY_METRIC}
						</h3>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-1.5">
						{show("metricType") && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
							{row.metricType}
						</span>}
						{show("serviceName") && <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 dark:bg-stone-900 dark:text-stone-300">
							{row.serviceName || "all services"}
						</span>}
						{show("lastSeen") && <span className="text-xs text-stone-500 dark:text-stone-400">{formatDate(row.lastSeen)}</span>}
					</div>
				</div>
				<div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:justify-end">
					{show("latestValue") && (
						<MiniMeta
							icon={<BarChart3 className="h-3.5 w-3.5" />}
							label="latest"
							value={`${Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-"} ${unit}`}
						/>
					)}
					{show("pointCount") && (
						<MiniMeta
							icon={<Info className="h-3.5 w-3.5" />}
							label="points"
							value={row.pointCount?.toLocaleString?.() || row.pointCount || 0}
						/>
					)}
					<MiniMeta
						icon={<BarChart3 className="h-3.5 w-3.5" />}
						label="avg"
						value={Number.isFinite(avgValue) ? avgValue.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-"}
					/>
					<MiniMeta
						icon={<BarChart3 className="h-3.5 w-3.5" />}
						label="range"
						value={`${Number.isFinite(minValue) ? minValue.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "-"} - ${Number.isFinite(maxValue) ? maxValue.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "-"}`}
					/>
					{observationCount > row.pointCount && (
						<MiniMeta
							icon={<Info className="h-3.5 w-3.5" />}
							label="obs"
							value={observationCount.toLocaleString()}
						/>
					)}
				</div>
			</div>
			<div className="mt-3">
				<div className="h-1.5 rounded-full bg-stone-100 dark:bg-stone-900">
					<div className="h-full rounded-full bg-emerald-500" style={{ width }} />
				</div>
				<div className="mt-1 flex items-center justify-between text-[11px] text-stone-400 dark:text-stone-500">
					<span>latest compared to max in this window</span>
					<div className="flex gap-2">
						<span>min {Number.isFinite(minValue) ? minValue.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-"}</span>
						<span>max {Number.isFinite(maxValue) ? maxValue.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-"}</span>
					</div>
				</div>
			</div>
		</button>
	);
}

function durationLabel(ms: number) {
	if (!Number.isFinite(ms) || ms <= 0) return "—";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const sec = ms / 1000;
	if (sec < 60) return `${sec.toFixed(1)}s`;
	const min = sec / 60;
	if (min < 60) return `${min.toFixed(1)}m`;
	return `${(min / 60).toFixed(1)}h`;
}

const SESSION_OUTCOME_TONE: Record<string, string> = {
	merged:
		"bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
	committed:
		"bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
	abandoned_with_change:
		"bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

const SESSION_CLASS_TONE: Record<string, string> = {
	work: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
	personal:
		"bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
	disputed: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

function tone(map: Record<string, string>, key: string) {
	return (
		map[key] ||
		"bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
	);
}

function CodingUserRecord({
	row,
	visibilityColumns,
	isSelected,
	onOpen,
}: {
	row: any;
	visibilityColumns: Record<string, boolean>;
	isSelected?: boolean;
	onOpen: (row: any) => void;
}) {
	const show = (key: string) => visibilityColumns[key] !== false;
	const masked = row.user === "low_cohort";
	const total = Math.max(
		1,
		Number(row.classification_work || 0) +
			Number(row.classification_personal || 0)
	);
	const workPct = (Number(row.classification_work || 0) / total) * 100;
	return (
		<button
			type="button"
			onClick={() => !masked && onOpen(row)}
			disabled={masked}
			className={`group w-full rounded-md border p-3 text-left transition ${
				isSelected
					? "border-violet-500 bg-violet-50 shadow-sm ring-1 ring-violet-200 dark:border-violet-500 dark:bg-violet-950/30 dark:ring-violet-900"
					: masked
						? "border-stone-200 bg-stone-50 cursor-not-allowed dark:border-stone-800 dark:bg-stone-900/40"
						: "border-stone-200 bg-white hover:border-violet-400 hover:bg-violet-50/60 dark:border-stone-800 dark:bg-stone-950 dark:hover:border-violet-700 dark:hover:bg-violet-950/20"
			}`}
		>
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-2">
						{/* Use the vendor's logo as the row leading icon when
						    we know it; falls back to the generic Bot icon
						    for an unknown vendor. We drop the separate
						    vendor pill below to avoid duplicating the
						    information. */}
						{hasCodingAgentVendorIcon(row.top_vendor) ? (
							<CodingAgentVendorIcon
								vendor={row.top_vendor}
								className="h-4 w-4 shrink-0"
							/>
						) : (
							<Bot className="h-4 w-4 shrink-0 text-violet-500" />
						)}
						<h3 className="truncate font-mono text-sm font-semibold text-stone-950 dark:text-stone-50">
							{masked ? "low cohort (privacy floor)" : row.user || "—"}
						</h3>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
						{show("lastSeen") && <span>Last {formatDate(row.last_seen)}</span>}
					</div>
				</div>
				<div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:justify-end">
					{show("sessions") && (
						<MiniMeta
							icon={<Bot className="h-3.5 w-3.5" />}
							label="sessions"
							value={Number(row.session_count || 0).toLocaleString()}
						/>
					)}
					{show("tools") && (
						<MiniMeta
							icon={<Wrench className="h-3.5 w-3.5" />}
							label="tools"
							value={Number(row.tool_call_count || 0).toLocaleString()}
						/>
					)}
					{show("cost") && (
						<MiniMeta
							icon={<DollarSign className="h-3.5 w-3.5" />}
							label="cost"
							value={`$${Number(row.cost_usd || 0).toFixed(4)}`}
						/>
					)}
					{show("tokens") && (
						<MiniMeta
							icon={<Hash className="h-3.5 w-3.5" />}
							label="tokens"
							value={compactNumber(Number(row.total_tokens || 0))}
						/>
					)}
					{show("mix") && (
						<MiniMeta
							icon={<Bot className="h-3.5 w-3.5" />}
							label="work%"
							value={`${Math.round(workPct)}%`}
						/>
					)}
				</div>
			</div>
		</button>
	);
}

function SessionRecord({
	row,
	visibilityColumns,
	isSelected,
	onOpen,
}: {
	row: any;
	visibilityColumns: Record<string, boolean>;
	isSelected?: boolean;
	onOpen: (row: any) => void;
}) {
	const show = (key: string) => visibilityColumns[key] !== false;
	const sessionId = row.session_id || "";
	// Cursor session ids are long UUIDs — show enough characters to disambiguate
	// at a glance but keep the row visually compact.
	const shortSessionId = sessionId
		? sessionId.length > 12
			? `${sessionId.slice(0, 12)}…`
			: sessionId
		: "—";
	const vendor = (row.vendor || "").toLowerCase();
	const totalTokens = Number(
		row.total_tokens ||
			Number(row.input_tokens || 0) + Number(row.output_tokens || 0)
	);
	// Repo / branch / working folder — surfaced as a thin metadata
	// strip below the identity row so a developer can pick a session
	// by repo without opening it. We trim noisy URL prefixes/suffixes
	// to keep the chip compact (e.g. "openlit/openlit @ main") and
	// fall back to the working-folder label when there's no VCS
	// remote (e.g. a fresh clone or a non-git workspace).
	const repoUrl = (row.repo_url || "").trim();
	const repoLabel = repoUrl
		? repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "")
		: "";
	const branchName = (row.branch || "").trim();
	const folderLabel = (row.working_dir_label || "").trim();
	return (
		<button
			type="button"
			onClick={() => onOpen(row)}
			className={`group w-full rounded-md border p-3 text-left transition ${
				isSelected
					? "border-violet-500 bg-violet-50 shadow-sm ring-1 ring-violet-200 dark:border-violet-500 dark:bg-violet-950/30 dark:ring-violet-900"
					: "border-stone-200 bg-white hover:border-violet-400 hover:bg-violet-50/60 dark:border-stone-800 dark:bg-stone-950 dark:hover:border-violet-700 dark:hover:bg-violet-950/20"
			}`}
		>
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div className="min-w-0">
					<div className="flex min-w-0 items-start gap-2">
						{hasCodingAgentVendorIcon(vendor) ? (
							<CodingAgentVendorIcon
								vendor={vendor}
								className="mt-0.5 h-4 w-4 shrink-0"
							/>
						) : (
							<Bot className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
						)}
						<div className="min-w-0">
							<h3
								className="truncate font-mono text-sm font-semibold text-stone-950 dark:text-stone-50"
								title={sessionId}
							>
								{shortSessionId}
							</h3>
							<div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
								{/* Vendor pill removed — the vendor icon
								    already sits to the left of the session id
								    so showing "cursor" here is redundant. */}
								{show("user") && row.user && (
									<span className="truncate text-xs text-stone-500 dark:text-stone-400">
										{row.user}
									</span>
								)}
								{row.model && (
									<span
										className="truncate rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 dark:bg-stone-900 dark:text-stone-300"
										title={row.model}
									>
										{row.model}
									</span>
								)}
							</div>
						</div>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
						{show("started") && <span>{formatDate(row.started_at)}</span>}
						{/* Outcome and classification often arrive as the literal
						   string "unknown" — Cursor's sessionEnd payload omits
						   `reason`, and the CLI classifier returns "unknown"
						   when no signal is decisive. Showing those as pills
						   just clutters the row with two grey "unknown" chips
						   per session. We render them only when they carry a
						   real value; "running" stands in for "session is
						   still open" so users still see SOMETHING when no
						   end-of-session telemetry has landed yet. */}
						{show("outcome") &&
							row.outcome &&
							row.outcome !== "unknown" && (
								<span
									className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone(
										SESSION_OUTCOME_TONE,
										row.outcome
									)}`}
								>
									{row.outcome}
								</span>
							)}
						{show("outcome") && (!row.outcome || row.outcome === "unknown") && (
							<span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
								running
							</span>
						)}
						{show("classification") &&
							row.classification &&
							row.classification !== "unknown" && (
								<span
									className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone(
										SESSION_CLASS_TONE,
										row.classification
									)}`}
									title={row.classification_reason || row.classification}
								>
									{row.classification}
								</span>
							)}
						{row.permission_mode && (
							<span
								className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 dark:bg-stone-900 dark:text-stone-300"
								title={`Last seen mode: ${row.permission_mode}`}
							>
								{row.permission_mode}
							</span>
						)}
						{repoLabel && (
							<span
								className="inline-flex items-center gap-1 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 dark:bg-stone-900 dark:text-stone-300"
								title={`${repoUrl}${branchName ? ` @ ${branchName}` : ""}`}
							>
								<GitBranch className="h-3 w-3 shrink-0" />
								{repoLabel}
								{branchName && (
									<span className="text-stone-400">@{branchName}</span>
								)}
							</span>
						)}
						{folderLabel && (
							<span
								className="inline-flex items-center gap-1 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 dark:bg-stone-900 dark:text-stone-300"
								title={row.working_dir || folderLabel}
							>
								<Folder className="h-3 w-3 shrink-0" />
								{folderLabel}
							</span>
						)}
					</div>
				</div>
				<div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:justify-end">
					{show("duration") && (
						<MiniMeta
							icon={<Clock className="h-3.5 w-3.5" />}
							label="duration"
							value={durationLabel(Number(row.duration_ms || 0))}
						/>
					)}
					{show("tools") && (
						<MiniMeta
							icon={<Wrench className="h-3.5 w-3.5" />}
							label="tools"
							value={Number(row.tool_call_count || 0).toLocaleString()}
						/>
					)}
					{show("tokens") && totalTokens > 0 && (
						<MiniMeta
							icon={<Hash className="h-3.5 w-3.5" />}
							label="tokens"
							value={compactNumber(totalTokens)}
						/>
					)}
					{show("cost") && (
						<MiniMeta
							icon={<DollarSign className="h-3.5 w-3.5" />}
							label="cost"
							value={`$${Number(row.cost_usd || 0).toFixed(4)}`}
						/>
					)}
				</div>
			</div>
		</button>
	);
}

function compactNumber(value: number): string {
	if (!Number.isFinite(value)) return "0";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return value.toLocaleString();
}

export default function SignalRecords({
	config,
	rows,
	visibilityColumns,
	isFetched,
	isLoading,
	onOpen,
	selectedId,
}: {
	config: ObservabilitySignalConfig;
	rows: any[];
	visibilityColumns: Record<string, boolean>;
	isFetched: boolean;
	isLoading: boolean;
	onOpen: (row: any) => void;
	selectedId?: string | null;
}) {
	if (isLoading) {
		return (
			<div className="grid gap-2">
				{Array.from({ length: 6 }).map((_, index) => (
					<div
						key={index}
						className="h-20 animate-pulse rounded-md border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900"
					/>
				))}
			</div>
		);
	}

	if (isFetched && rows.length === 0) {
		return (
			<div className="rounded-md border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
				No {config.label.toLowerCase()} found for the selected filters.
			</div>
		);
	}

	if (config.key === "metrics") {
		return (
			<div className="grid gap-2">
				{rows.map((row) => (
					<MetricRecord
						key={config.getRowId(row)}
						row={row}
						visibilityColumns={visibilityColumns}
						isSelected={selectedId === config.getRowId(row)}
						onOpen={onOpen}
					/>
				))}
			</div>
		);
	}

	if (config.key === "sessions") {
		return (
			<div className="grid gap-2">
				{rows.map((row) => (
					<SessionRecord
						key={config.getRowId(row)}
						row={row}
						visibilityColumns={visibilityColumns}
						// For sessions, `selectedId` is the OPEN session's root
						// SpanId (the parent passes `previewSpanId`, not the live
						// `?selected=` value). It stays put while the developer
						// drills into child spans inside the sheet, so the row
						// highlight no longer flickers off on each span click.
						isSelected={selectedId === row.session_root_span_id}
						onOpen={onOpen}
					/>
				))}
			</div>
		);
	}

	if (config.key === "coding_users") {
		return (
			<div className="grid gap-2">
				{rows.map((row) => (
					<CodingUserRecord
						key={config.getRowId(row)}
						row={row}
						visibilityColumns={visibilityColumns}
						isSelected={selectedId === config.getRowId(row)}
						onOpen={onOpen}
					/>
				))}
			</div>
		);
	}

	return (
		<div className="grid gap-2">
			{rows.map((row) =>
				config.key === "logs" ? (
					<LogRecord
						key={config.getRowId(row)}
						row={row}
						visibilityColumns={visibilityColumns}
						isSelected={selectedId === config.getRowId(row)}
						onOpen={onOpen}
					/>
				) : (
					<TraceRecord
						key={config.getRowId(row)}
						row={row}
						config={config}
						visibilityColumns={visibilityColumns}
						isSelected={selectedId === row.spanId}
						onOpen={onOpen}
					/>
				)
			)}
		</div>
	);
}
