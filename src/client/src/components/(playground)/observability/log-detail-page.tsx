"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Clock, FileText, GitBranch, Hash, Server, Siren } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import DetailShell from "./detail-shell";
import AttributeGrid from "./attribute-grid";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";

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
			url: `/api/observability/logs/${id}`,
		});
	}, [fireRequest, id]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const record = (data as any)?.record;
	const severity = String(record?.SeverityText || "unknown severity");
	const normalizedSeverity = severity.toLowerCase();
	const severityClass =
		normalizedSeverity === "error" || normalizedSeverity === "fatal"
			? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
			: normalizedSeverity === "warn" || normalizedSeverity === "warning"
				? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
				: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300";
	const goBack = () => router.push(from || "/observability?tab=logs");

	return (
		<DetailShell
			title={m.OBSERVABILITY_LOG_ENTRY}
			leadingActions={
				variant === "page" ? (
					<Button
						variant="outline"
						size="sm"
						onClick={goBack}
						className="h-8 gap-1.5 px-2"
					>
						<ArrowLeft className="h-3.5 w-3.5" />
						{m.OBSERVABILITY_BACK}
					</Button>
				) : undefined
			}
			actions={extraActions}
			headerMeta={
				record ? (
					<div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
						<div className={`rounded-md border px-3 py-2 ${severityClass}`}>
							<div className="flex items-center gap-1.5 text-xs font-medium">
								<Siren className="h-3.5 w-3.5" />
								{m.OBSERVABILITY_SEVERITY}
							</div>
							<div className="mt-1 truncate font-semibold">{severity}</div>
						</div>
						<MetaTile icon={<Clock className="h-3.5 w-3.5" />} label={m.OBSERVABILITY_TIME} value={record.Timestamp} />
						<MetaTile icon={<Server className="h-3.5 w-3.5" />} label={m.OBSERVABILITY_SERVICE} value={record.ServiceName} />
						<MetaTile icon={<GitBranch className="h-3.5 w-3.5" />} label={m.OBSERVABILITY_TRACE_ID} value={record.TraceId} />
						<MetaTile icon={<Hash className="h-3.5 w-3.5" />} label={m.OBSERVABILITY_SPAN_ID} value={record.SpanId} />
					</div>
				) : undefined
			}
		>
			{record && (
				<>
					<section className="rounded-md border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900 p-3">
						<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
							<FileText className="h-3.5 w-3.5" />
							{m.OBSERVABILITY_BODY}
						</div>
						<pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-stone-200 bg-white p-3 font-mono text-sm leading-6 text-stone-900 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100">
							{record.Body || "-"}
						</pre>
						<div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-500 dark:text-stone-400">
							{record.TraceId && (
								<Link
									className="rounded-md border border-stone-200 bg-white px-2 py-1 font-mono hover:text-primary dark:border-stone-800 dark:bg-stone-950"
									href={`/observability?tab=traces&traceId=${record.TraceId}`}
								>
									trace:{record.TraceId}
								</Link>
							)}
							{record.SpanId && (
								<Link
									className="rounded-md border border-stone-200 bg-white px-2 py-1 font-mono hover:text-primary dark:border-stone-800 dark:bg-stone-950"
									href={`/observability/traces/${record.SpanId}?from=${encodeURIComponent(from || "/observability?tab=logs")}`}
								>
									span:{record.SpanId}
								</Link>
							)}
						</div>
					</section>
					<AttributeGrid title={m.OBSERVABILITY_LOG_ATTRIBUTES} data={record.LogAttributes} />
					<AttributeGrid title={m.OBSERVABILITY_RESOURCE_ATTRIBUTES} data={record.ResourceAttributes} />
					<AttributeGrid title={m.OBSERVABILITY_SCOPE_ATTRIBUTES} data={record.ScopeAttributes} />
					<AttributeGrid title={m.OBSERVABILITY_RAW_LOG} data={record} />
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
