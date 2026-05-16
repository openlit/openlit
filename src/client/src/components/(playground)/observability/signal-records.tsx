"use client";

import { format } from "date-fns";
import {
	BarChart3,
	Clock,
	Hash,
	Info,
	Zap,
} from "lucide-react";
import { ObservabilitySignalConfig } from "./registry";
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
			className={`rounded-md border p-3 text-left transition ${
				isSelected
					? "border-emerald-500 bg-emerald-50 shadow-sm ring-1 ring-emerald-200 dark:border-emerald-500 dark:bg-emerald-950/30 dark:ring-emerald-900"
					: "border-stone-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/60 dark:border-stone-800 dark:bg-stone-950 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/20"
			}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
						{show("metricName") ? row.metricName : m.OBSERVABILITY_METRIC}
					</h3>
					<div className="mt-1 flex flex-wrap gap-1.5">
						{show("metricType") && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
							{row.metricType}
						</span>}
						{show("serviceName") && <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 dark:bg-stone-900 dark:text-stone-300">
							{row.serviceName || "all services"}
						</span>}
					</div>
				</div>
				<BarChart3 className="h-4 w-4 shrink-0 text-emerald-500" />
			</div>
			<div className="mt-4">
				<div className="flex items-end justify-between gap-2">
					<div className="min-w-0">
						<div className="text-[11px] uppercase tracking-wide text-stone-400 dark:text-stone-500">
							Latest
						</div>
						{show("latestValue") && <span className="text-xl font-semibold tabular-nums text-stone-950 dark:text-stone-50">
							{Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-"}
						</span>}
					</div>
					{show("metricUnit") && <span className="text-xs text-stone-500 dark:text-stone-400">
						{unit}
					</span>}
				</div>
				<div className="mt-2 h-2 rounded-full bg-stone-100 dark:bg-stone-900">
					<div className="h-full rounded-full bg-emerald-500" style={{ width }} />
				</div>
				<div className="mt-3 grid grid-cols-2 gap-1.5 text-xs text-stone-500 dark:text-stone-400">
					{show("pointCount") && <span className="inline-flex items-center gap-1">
						<Info className="h-3.5 w-3.5" />
						{row.pointCount?.toLocaleString?.() || row.pointCount || 0} points
					</span>}
					{observationCount > row.pointCount && <span>{observationCount.toLocaleString()} observations</span>}
					<span>avg {Number.isFinite(avgValue) ? avgValue.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-"}</span>
					<span>min {Number.isFinite(minValue) ? minValue.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-"}</span>
					<span>max {Number.isFinite(maxValue) ? maxValue.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-"}</span>
				</div>
				{show("lastSeen") && <div className="mt-2 text-xs text-stone-500 dark:text-stone-400">{formatDate(row.lastSeen)}</div>}
				<p className="mt-2 text-[11px] text-stone-400 dark:text-stone-500">
					Range is calculated from this metric&apos;s values in the selected time window.
				</p>
			</div>
		</button>
	);
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
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
