"use client";

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
	ArrowLeft,
	BadgeDollarSign,
	Clock,
	FileText,
	Gauge,
	GitBranch,
	Hash,
	MessageSquareText,
	Server,
	Siren,
	Zap,
} from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import DetailShell from "./detail-shell";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
import DetailObjectTabs, { buildObjectTabs } from "./detail-object-tabs";

function MetaTile({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode;
	label: string;
	value?: string | number;
}) {
	return (
		<div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/50">
			<div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
				{icon}
				{label}
			</div>
			<div className="mt-1 truncate font-mono text-xs font-semibold text-stone-950 dark:text-stone-50">
				{value || "-"}
			</div>
		</div>
	);
}

function compactValue(value: unknown) {
	if (value === "" || value === null || value === undefined) return undefined;
	return String(value);
}

function formatNumber(value: unknown) {
	const numberValue = Number(value);
	if (!Number.isFinite(numberValue)) return compactValue(value);
	return numberValue.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function sumNumeric(values: unknown[]) {
	return values.reduce<number>((total, value) => {
		const numberValue = Number(value);
		return Number.isFinite(numberValue) ? total + numberValue : total;
	}, 0);
}

function ContextPill({ label, value }: { label: string; value?: unknown }) {
	const displayValue = compactValue(value);
	if (!displayValue) return null;
	return (
		<div className="min-w-0 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 dark:border-stone-800 dark:bg-stone-950">
			<div className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
				{label}
			</div>
			<div
				className="max-w-64 truncate font-mono text-xs text-stone-900 dark:text-stone-100"
				title={displayValue}
			>
				{displayValue}
			</div>
		</div>
	);
}

export function LogDetailView({
	id,
	from,
	variant = "page",
	extraActions,
}: {
	id: string;
	from?: string | null;
	variant?: "page" | "sheet";
	extraActions?: ReactNode;
}) {
	const m = getMessage();
	const router = useRouter();
	const { data, fireRequest } = useFetchWrapper();

	const fetchData = useCallback(() => {
		fireRequest({
			requestType: "GET",
			url: `/api/telemetry/logs/${id}`,
		});
	}, [fireRequest, id]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const record = (data as any)?.record;
	const logAttributes = record?.LogAttributes || {};
	const eventName = compactValue(logAttributes["event.name"]);
	const logTitle =
		[record?.Body, eventName].filter(Boolean).join(" / ") ||
		m.OBSERVABILITY_LOG_ENTRY;
	const totalTokens = sumNumeric([
		logAttributes.input_tokens,
		logAttributes.output_tokens,
		logAttributes.cache_read_tokens,
		logAttributes.cache_creation_tokens,
	]);
	const severity = String(record?.SeverityText || "unknown severity");
	const normalizedSeverity = severity.toLowerCase();
	const severityClass =
		normalizedSeverity === "error" || normalizedSeverity === "fatal"
			? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
			: normalizedSeverity === "warn" || normalizedSeverity === "warning"
				? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
				: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300";
	const detailTabs = useMemo(
		() => buildObjectTabs(record, {
			labelOverrides: {
				LogAttributes: "Log Attributes",
				ResourceAttributes: "Resource Attributes",
				ScopeAttributes: "Scope Attributes",
			},
		}),
		[record]
	);
	const tokenSummary = totalTokens
		? `${totalTokens.toLocaleString()} total`
		: undefined;
	const goBack = () => router.push(from || "/telemetry?tab=logs");

	return (
		<DetailShell
			title={logTitle}
			leadingActions={
				variant === "page" ? (
					<Button
						variant="outline"
						size="sm"
						onClick={goBack}
						className="h-8 w-8 p-0"
						title={m.OBSERVABILITY_BACK}
					>
						<ArrowLeft className="h-3.5 w-3.5" />
					</Button>
				) : undefined
			}
			actions={extraActions}
			headerMeta={
				record ? (
					<div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-6">
						<div className={`rounded-md border px-3 py-2 ${severityClass}`}>
							<div className="flex items-center gap-1.5 text-xs font-medium">
								<Siren className="h-3.5 w-3.5" />
								{m.OBSERVABILITY_SEVERITY}
							</div>
							<div className="mt-1 truncate font-semibold">{severity}</div>
						</div>
						<MetaTile icon={<Clock className="h-3.5 w-3.5" />} label={m.OBSERVABILITY_TIME} value={record.Timestamp} />
						<MetaTile icon={<Server className="h-3.5 w-3.5" />} label={m.OBSERVABILITY_SERVICE} value={record.ServiceName} />
						<MetaTile icon={<MessageSquareText className="h-3.5 w-3.5" />} label="Event" value={eventName || record.Body} />
						<MetaTile icon={<BadgeDollarSign className="h-3.5 w-3.5" />} label="Cost" value={logAttributes.cost_usd ? `$${formatNumber(logAttributes.cost_usd)}` : undefined} />
						<MetaTile icon={<Zap className="h-3.5 w-3.5" />} label="Tokens" value={tokenSummary} />
					</div>
				) : undefined
			}
		>
			{record && (
				<>
					<section className="rounded-md border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900">
						<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
							<FileText className="h-3.5 w-3.5" />
							Log Summary
						</div>
						<div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
							<ContextPill label="Body" value={record.Body} />
							<ContextPill label="Duration" value={logAttributes.duration_ms ? `${formatNumber(logAttributes.duration_ms)} ms` : undefined} />
							<ContextPill label="Input" value={logAttributes.input_tokens ? `${formatNumber(logAttributes.input_tokens)} tokens` : undefined} />
							<ContextPill label="Output" value={logAttributes.output_tokens ? `${formatNumber(logAttributes.output_tokens)} tokens` : undefined} />
							<ContextPill label="Cache Read" value={logAttributes.cache_read_tokens ? `${formatNumber(logAttributes.cache_read_tokens)} tokens` : undefined} />
						</div>
						<div className="mt-3 flex flex-wrap gap-2">
							<ContextPill label="Request" value={logAttributes.request_id} />
							<ContextPill label="Model" value={logAttributes.model} />
							<ContextPill label="Source" value={logAttributes.query_source} />
							<ContextPill label="Session" value={logAttributes["session.id"]} />
							<ContextPill label="Prompt" value={logAttributes["prompt.id"]} />
							<ContextPill label="Terminal" value={logAttributes["terminal.type"]} />
							<ContextPill label="User" value={logAttributes["user.email"]} />
						</div>
						<div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-500 dark:text-stone-400">
							{record.TraceId && (
								<Link
									className="rounded-md border border-stone-200 bg-white px-2 py-1 font-mono hover:text-primary dark:border-stone-800 dark:bg-stone-950"
									href={`/telemetry?tab=traces&traceId=${record.TraceId}`}
								>
									trace:{record.TraceId}
								</Link>
							)}
							{record.SpanId && (
								<Link
									className="rounded-md border border-stone-200 bg-white px-2 py-1 font-mono hover:text-primary dark:border-stone-800 dark:bg-stone-950"
									href={`/telemetry/traces/${record.SpanId}?from=${encodeURIComponent(from || "/telemetry?tab=logs")}`}
								>
									span:{record.SpanId}
								</Link>
							)}
							{record.TraceId && (
								<MetaTile icon={<GitBranch className="h-3.5 w-3.5" />} label={m.OBSERVABILITY_TRACE_ID} value={record.TraceId} />
							)}
							{record.SpanId && (
								<MetaTile icon={<Hash className="h-3.5 w-3.5" />} label={m.OBSERVABILITY_SPAN_ID} value={record.SpanId} />
							)}
							<MetaTile icon={<Gauge className="h-3.5 w-3.5" />} label="Scope" value={record.ScopeName} />
						</div>
					</section>
					<DetailObjectTabs tabs={detailTabs} />
				</>
			)}
		</DetailShell>
	);
}

export default function LogDetailPage({ id }: { id: string }) {
	const searchParams = useSearchParams();

	return (
		<LogDetailView
			id={id}
			from={searchParams.get("from")}
			variant="page"
		/>
	);
}
