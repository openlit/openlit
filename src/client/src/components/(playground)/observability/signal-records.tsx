"use client";

import { useState } from "react";
import { format } from "date-fns";
import {
	BarChart3,
	ChevronDown,
	ChevronRight,
	Clock,
	ExternalLink,
	FileText,
	GitBranch,
	Hash,
	Info,
	Server,
	Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ObservabilitySignalConfig } from "./registry";

function formatDate(value?: string) {
	if (!value) return "-";
	try {
		return format(new Date(value), "MMM d, HH:mm:ss");
	} catch {
		return value;
	}
}

function formatJson(value: unknown) {
	if (value == null || value === "") return "-";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function DetailBlock({ title, data }: { title: string; data: unknown }) {
	return (
		<div className="min-w-0 rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
			<div className="border-b border-stone-200 px-3 py-2 text-xs font-semibold text-stone-600 dark:border-stone-800 dark:text-stone-300">
				{title}
			</div>
			<pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-stone-700 dark:text-stone-200">
				{formatJson(data)}
			</pre>
		</div>
	);
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
	onOpen,
}: {
	row: any;
	config: ObservabilitySignalConfig;
	onOpen: (row: any) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onOpen(row)}
			className="group w-full rounded-md border border-stone-200 bg-white p-3 text-left transition hover:border-primary/50 hover:bg-primary/5 dark:border-stone-800 dark:bg-stone-950 dark:hover:border-primary/60 dark:hover:bg-primary/10"
		>
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-2">
						<span className={`h-2 w-2 rounded-full ${config.key === "exceptions" ? "bg-rose-500" : "bg-sky-500"}`} />
						<h3 className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
							{row.spanName || row.id}
						</h3>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
						<span>{row.time}</span>
						<span className="font-mono">{row.spanId}</span>
						{row.serviceName && <span>{row.serviceName}</span>}
					</div>
				</div>
				<div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:justify-end">
					<MiniMeta icon={<Clock className="h-3.5 w-3.5" />} label="duration" value={`${parseFloat(row.requestDuration || "0").toFixed(3)}s`} />
					<MiniMeta icon={<Zap className="h-3.5 w-3.5" />} label="tokens" value={row.totalTokens} />
					<MiniMeta icon={<Hash className="h-3.5 w-3.5" />} label="model" value={row.model || row.system} />
				</div>
			</div>
		</button>
	);
}

function LogRecord({
	row,
	onOpen,
}: {
	row: any;
	onOpen: (row: any) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const severity = String(row.SeverityText || "INFO");
	const normalizedSeverity = severity.toLowerCase();
	const isError = ["error", "fatal"].includes(normalizedSeverity);
	const isWarn = ["warn", "warning"].includes(normalizedSeverity);
	const severityClass = isError
		? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
		: isWarn
			? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
			: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300";
	const coreFields = {
		Timestamp: row.Timestamp,
		TraceId: row.TraceId,
		SpanId: row.SpanId,
		SeverityText: row.SeverityText,
		SeverityNumber: row.SeverityNumber,
		ServiceName: row.ServiceName,
		ScopeName: row.ScopeName,
		ScopeVersion: row.ScopeVersion,
	};

	return (
		<div className="rounded-md border border-stone-200 bg-white font-mono dark:border-stone-800 dark:bg-stone-950">
			<button
				type="button"
				onClick={() => setExpanded((value) => !value)}
				className="flex w-full items-start gap-3 p-3 text-left hover:bg-stone-50 dark:hover:bg-stone-900/60"
			>
				<span className="mt-0.5 text-stone-400">
					{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
				</span>
				<div className="min-w-0 grow">
					<div className="flex flex-wrap items-center gap-2">
						<span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${severityClass}`}>
							{severity}
						</span>
						<span className="text-xs text-stone-500 dark:text-stone-400">
							{formatDate(row.Timestamp)}
						</span>
						<span className="text-xs text-stone-500 dark:text-stone-400">
							{row.ServiceName || "unknown service"}
						</span>
					</div>
					<p className="mt-1 truncate text-sm text-stone-900 dark:text-stone-100">
						{row.Body || "-"}
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 shrink-0 px-2"
					onClick={(event) => {
						event.stopPropagation();
						onOpen(row);
					}}
				>
					<ExternalLink className="h-3.5 w-3.5" />
				</Button>
			</button>
			{expanded && (
				<div className="border-t border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/50">
					<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-stone-200 bg-white p-3 text-xs leading-5 text-stone-800 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100">
						{row.Body || "-"}
					</pre>
					<div className="mt-3 flex flex-wrap gap-2">
						<MiniMeta icon={<FileText className="h-3.5 w-3.5" />} label="row" value={row.rowId} />
						<MiniMeta icon={<GitBranch className="h-3.5 w-3.5" />} label="trace" value={row.TraceId} />
						<MiniMeta icon={<Hash className="h-3.5 w-3.5" />} label="span" value={row.SpanId} />
						<MiniMeta icon={<Server className="h-3.5 w-3.5" />} label="scope" value={row.ScopeName} />
					</div>
					<div className="mt-3 grid gap-3 xl:grid-cols-2">
						<DetailBlock title="Fields" data={coreFields} />
						<DetailBlock title="Log Attributes" data={row.LogAttributes} />
						<DetailBlock title="Resource Attributes" data={row.ResourceAttributes} />
						<DetailBlock title="Scope Attributes" data={row.ScopeAttributes} />
						<DetailBlock title="Raw Log" data={row} />
					</div>
				</div>
			)}
		</div>
	);
}

function MetricRecord({
	row,
	onOpen,
}: {
	row: any;
	onOpen: (row: any) => void;
}) {
	const value = typeof row.latestValue === "number" ? row.latestValue : Number(row.latestValue || 0);
	const width = `${Math.max(8, Math.min(100, Number(row.relativeValue || 0)))}%`;

	return (
		<button
			type="button"
			onClick={() => onOpen(row)}
			className="rounded-md border border-stone-200 bg-white p-3 text-left transition hover:border-emerald-400 hover:bg-emerald-50/60 dark:border-stone-800 dark:bg-stone-950 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/20"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">
						{row.metricName}
					</h3>
					<div className="mt-1 flex flex-wrap gap-1.5">
						<span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
							{row.metricType}
						</span>
						<span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 dark:bg-stone-900 dark:text-stone-300">
							{row.serviceName || "all services"}
						</span>
					</div>
				</div>
				<BarChart3 className="h-4 w-4 shrink-0 text-emerald-500" />
			</div>
			<div className="mt-4">
				<div className="flex items-end justify-between gap-2">
					<span className="text-xl font-semibold tabular-nums text-stone-950 dark:text-stone-50">
						{Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-"}
					</span>
					<span className="text-xs text-stone-500 dark:text-stone-400">
						{row.metricUnit || "value"}
					</span>
				</div>
				<div className="mt-2 h-2 rounded-full bg-stone-100 dark:bg-stone-900">
					<div className="h-full rounded-full bg-emerald-500" style={{ width }} />
				</div>
				<div className="mt-3 flex items-center justify-between gap-3 text-xs text-stone-500 dark:text-stone-400">
					<span className="inline-flex items-center gap-1">
						<Info className="h-3.5 w-3.5" />
						{row.pointCount?.toLocaleString?.() || row.pointCount || 0} points
					</span>
					<span>{formatDate(row.lastSeen)}</span>
				</div>
			</div>
		</button>
	);
}

export default function SignalRecords({
	config,
	rows,
	isFetched,
	isLoading,
	onOpen,
}: {
	config: ObservabilitySignalConfig;
	rows: any[];
	isFetched: boolean;
	isLoading: boolean;
	onOpen: (row: any) => void;
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
		const maxValue = rows.reduce((max, row) => {
			const value = Math.abs(Number(row.latestValue || 0));
			return Math.max(max, Number.isFinite(value) ? value : 0);
		}, 0);
		const metricRows = rows.map((row) => ({
			...row,
			relativeValue: maxValue > 0 ? (Math.abs(Number(row.latestValue || 0)) / maxValue) * 100 : 0,
		}));
		return (
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
				{metricRows.map((row) => (
					<MetricRecord key={config.getRowId(row)} row={row} onOpen={onOpen} />
				))}
			</div>
		);
	}

	return (
		<div className="grid gap-2">
			{rows.map((row) =>
				config.key === "logs" ? (
					<LogRecord key={config.getRowId(row)} row={row} onOpen={onOpen} />
				) : (
					<TraceRecord
						key={config.getRowId(row)}
						row={row}
						config={config}
						onOpen={onOpen}
					/>
				)
			)}
		</div>
	);
}
