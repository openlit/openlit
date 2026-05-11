"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import DetailShell from "./detail-shell";
import AttributeGrid from "./attribute-grid";

export default function LogDetailPage({ id }: { id: string }) {
	const searchParams = useSearchParams();
	const from = searchParams.get("from");
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
	return (
		<DetailShell
			title={record?.Body || "Log entry"}
			subtitle={`${record?.ServiceName || "unknown service"} / ${record?.SeverityText || "unknown severity"}`}
		>
			{record && (
				<>
					<section className="rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 p-3">
						<div className="text-xs text-stone-500 dark:text-stone-400">
							Body
						</div>
						<pre className="mt-2 whitespace-pre-wrap break-words text-sm text-stone-900 dark:text-stone-100">
							{record.Body || "-"}
						</pre>
						<div className="mt-3 flex flex-wrap gap-2 text-xs text-stone-500 dark:text-stone-400">
							<span>{record.Timestamp}</span>
							{record.TraceId && (
								<Link
									className="font-mono hover:text-primary"
									href={`/observability?tab=traces&traceId=${record.TraceId}`}
								>
									trace:{record.TraceId}
								</Link>
							)}
							{record.SpanId && (
								<Link
									className="font-mono hover:text-primary"
									href={`/observability/traces/${record.SpanId}?from=${encodeURIComponent(from || "/observability?tab=logs")}`}
								>
									span:{record.SpanId}
								</Link>
							)}
						</div>
					</section>
					<AttributeGrid title="Log Attributes" data={record.LogAttributes} />
					<AttributeGrid title="Resource Attributes" data={record.ResourceAttributes} />
					<AttributeGrid title="Scope Attributes" data={record.ScopeAttributes} />
				</>
			)}
		</DetailShell>
	);
}
