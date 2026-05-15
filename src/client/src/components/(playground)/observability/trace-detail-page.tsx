"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import DetailShell from "./detail-shell";
import AttributeGrid from "./attribute-grid";
import { normalizeTrace } from "@/helpers/client/trace";
import { getTimeLimitObject } from "@/store/filter";
import { FilterConfig, FilterType, TIME_RANGES } from "@/types/store/filter";
import { useCustomBreadcrumbs } from "@/utils/hooks/useBreadcrumbs";
import { ChevronLeft, ChevronRight, Clock, Cpu, DollarSign, Hash, Server, Zap } from "lucide-react";
import SpanHierarchyExplorer from "./span-hierarchy-explorer";

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value?: string }) {
	return (
		<div className="rounded-md bg-stone-100 dark:bg-stone-900 px-3 py-2">
			<div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
				{icon}
				{label}
			</div>
			<div className="mt-1 truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
				{value || "-"}
			</div>
		</div>
	);
}

const CF_SEP = "|";

function paramsToSelectedConfig(params: URLSearchParams): Partial<FilterConfig> {
	const config: Partial<FilterConfig> = {};
	const assignList = (param: string, key: keyof FilterConfig) => {
		const value = params.get(param);
		if (value) (config as any)[key] = value.split(",").filter(Boolean);
	};
	assignList("models", "models");
	assignList("providers", "providers");
	assignList("traceTypes", "traceTypes");
	assignList("appNames", "applicationNames");
	assignList("spanNames", "spanNames");
	assignList("envs", "environments");
	assignList("services", "services");
	assignList("severities", "severities");
	assignList("metricNames", "metricNames");
	assignList("metricTypes", "metricTypes");
	const maxCost = params.get("maxCost");
	if (maxCost) config.maxCost = parseFloat(maxCost);
	const cfValues = params.getAll("cf");
	if (cfValues.length) {
		config.customFilters = cfValues
			.map((raw) => {
				const [attributeType, key, ...rest] = raw.split(CF_SEP);
				return {
					attributeType: (attributeType || "SpanAttributes") as any,
					key: key || "",
					value: rest.join(CF_SEP),
				};
			})
			.filter((filter) => filter.key && filter.value);
	}
	return config;
}

function filterFromSource(from: string | null, offsetOverride?: number): FilterType {
	const params = new URLSearchParams();
	if (from && typeof window !== "undefined") {
		const url = new URL(from, window.location.origin);
		url.searchParams.forEach((value, key) => params.append(key, value));
	}

	const range = (params.get("tr") || "24H") as TIME_RANGES;
	const customStart = params.get("ts");
	const customEnd = params.get("te");
	const timeLimit =
		range === "CUSTOM" && customStart && customEnd
			? { type: range, start: new Date(customStart), end: new Date(customEnd) }
			: {
					type: range,
					...(getTimeLimitObject(range, "") as { start: Date; end: Date }),
			  };

	return {
		timeLimit,
		limit: parseInt(params.get("limit") || "25", 10),
		offset: offsetOverride ?? parseInt(params.get("offset") || "0", 10),
		selectedConfig: paramsToSelectedConfig(params),
		sorting: { type: "Timestamp", direction: "desc" },
		refreshRate: "1m",
		filterReady: true,
		groupBy: params.get("gb") || undefined,
		groupValue: params.get("gbv") || undefined,
	};
}

export function TraceDetailView({
	spanId,
	type,
	variant = "page",
	onSpanChange,
}: {
	spanId: string;
	type: "traces" | "exceptions";
	variant?: "page" | "sheet";
	onSpanChange?: (spanId: string) => void;
}) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const from = searchParams.get("from");
	const [selectedSpanId, setSelectedSpanId] = useState(spanId);
	const [activeListSpanId, setActiveListSpanId] = useState(spanId);
	const hierarchySpanIdRef = useRef(spanId);
	const [listOffset, setListOffset] = useState(() => filterFromSource(from).offset);
	const fromRef = useRef(from);
	const listUrlRef = useRef(type === "exceptions" ? "/api/metrics/exception" : "/api/metrics/request");
	const detailBasePathRef = useRef(
		type === "exceptions" ? "/observability/exceptions" : "/observability/traces"
	);
	const { data, fireRequest, isLoading } = useFetchWrapper();
	const {
		data: listData,
		fireRequest: fireListRequest,
		isLoading: isListLoading,
	} = useFetchWrapper<any>();
	const fetchData = useCallback(() => {
		fireRequest({
			requestType: "GET",
			url: `/api/metrics/request/span/${selectedSpanId}`,
		});
	}, [fireRequest, selectedSpanId]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const navigateToListSpan = useCallback(
		(nextSpanId: string) => {
			hierarchySpanIdRef.current = nextSpanId;
			setActiveListSpanId(nextSpanId);
			setSelectedSpanId(nextSpanId);
			const source = fromRef.current;
			const qs = source ? `?from=${encodeURIComponent(source)}` : "";
			if (variant === "page") {
				router.replace(`${detailBasePathRef.current}/${nextSpanId}${qs}`, { scroll: false });
			}
			onSpanChange?.(nextSpanId);
		},
		[onSpanChange, router, variant]
	);

	const selectSpanInCurrentTrace = useCallback((nextSpanId: string) => {
		setSelectedSpanId(nextSpanId);
	}, []);

	const fetchList = useCallback(
		(offset: number, direction?: -1 | 1) => {
			fireListRequest({
				body: JSON.stringify(filterFromSource(fromRef.current, offset)),
				requestType: "POST",
				url: listUrlRef.current,
				successCb: (response) => {
					if (!direction) return;
					const records = ((response as any)?.records || []).map(normalizeTrace);
					const target =
						direction === 1 ? records[0] : records[records.length - 1];
					if (target?.spanId) {
						setListOffset(offset);
						navigateToListSpan(target.spanId);
					}
				},
			});
		},
		[fireListRequest, navigateToListSpan]
	);

	useEffect(() => {
		fetchList(listOffset);
		// Only hydrate the neighboring list once. Explicit page-boundary navigation
		// fetches another page on demand; making this reactive causes route updates
		// to cascade into repeated list fetches.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const raw = (data as any)?.record;
	const trace = raw ? normalizeTrace(raw) : null;
	const title = trace?.spanName || (isLoading ? "Loading trace..." : selectedSpanId);
	const signalLabel = type === "exceptions" ? "Exceptions" : "Traces";
	const resultsHref =
		from || `/observability?tab=${type === "exceptions" ? "exceptions" : "traces"}`;
	const breadcrumbTitle = trace?.spanName || (isLoading ? "Loading..." : "Trace Details");

	const customHeader = useMemo(
		() => ({
			title: breadcrumbTitle,
			description: selectedSpanId,
			breadcrumbs: [
				{ title: "Observability", href: resultsHref },
			],
		}),
		[breadcrumbTitle, resultsHref, selectedSpanId]
	);
	useCustomBreadcrumbs(customHeader, [selectedSpanId, resultsHref], variant === "page");
	const listRows = useMemo(
		() => (((listData as any)?.records || []).map(normalizeTrace)),
		[listData]
	);
	const total = (listData as any)?.total || 0;
	const currentIndex = listRows.findIndex((row: any) => row.spanId === activeListSpanId);
	const canPrev = currentIndex > 0 || listOffset > 0;
	const canNext =
		currentIndex >= 0 &&
		(currentIndex < listRows.length - 1 || listOffset + listRows.length < total);

	const selectPrev = () => {
		if (currentIndex > 0) {
			navigateToListSpan(listRows[currentIndex - 1].spanId);
		} else if (listOffset > 0) {
			fetchList(Math.max(0, listOffset - filterFromSource(fromRef.current).limit), -1);
		}
	};

	const selectNext = () => {
		if (currentIndex >= 0 && currentIndex < listRows.length - 1) {
			navigateToListSpan(listRows[currentIndex + 1].spanId);
		} else if (listOffset + listRows.length < total) {
			fetchList(listOffset + filterFromSource(fromRef.current).limit, 1);
		}
	};

	return (
		<DetailShell
			title={title}
			subtitle={trace ? `${trace.serviceName || "unknown service"} / ${trace.applicationName || "unknown app"}` : selectedSpanId}
			headerMeta={
				trace ? (
					<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
						<Stat icon={<Clock className="h-3.5 w-3.5" />} label="Duration" value={`${parseFloat(trace.requestDuration).toFixed(3)}s`} />
						<Stat icon={<Zap className="h-3.5 w-3.5" />} label="Tokens" value={trace.totalTokens} />
						<Stat icon={<DollarSign className="h-3.5 w-3.5" />} label="Cost" value={trace.cost ? `$${trace.cost}` : undefined} />
						<Stat icon={<Cpu className="h-3.5 w-3.5" />} label="Model" value={trace.model || trace.serviceName} />
					</div>
				) : undefined
			}
			actions={
				<div className="flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-0.5">
					<button
						onClick={selectPrev}
						disabled={!canPrev || isListLoading}
						className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-30 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
						title="Previous span"
					>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<span className="min-w-[4.5rem] px-1 text-center text-xs tabular-nums text-stone-500 dark:text-stone-400">
						{currentIndex >= 0 ? `${listOffset + currentIndex + 1} / ${total || listRows.length}` : "-"}
					</span>
					<button
						onClick={selectNext}
						disabled={!canNext || isListLoading}
						className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-30 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
						title="Next span"
					>
						<ChevronRight className="h-4 w-4" />
					</button>
				</div>
			}
		>
			{trace && (
				<>
					<div className="grid grid-cols-1 gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/50 md:grid-cols-2 xl:grid-cols-5">
						<Stat icon={<Hash className="h-3.5 w-3.5" />} label="Trace ID" value={trace.id} />
						<Stat icon={<Hash className="h-3.5 w-3.5" />} label="Span ID" value={trace.spanId} />
						<Stat icon={<Server className="h-3.5 w-3.5" />} label="Service" value={trace.serviceName} />
						<Stat icon={<Server className="h-3.5 w-3.5" />} label="Application" value={trace.applicationName} />
						<Stat icon={<Cpu className="h-3.5 w-3.5" />} label="System" value={trace.system} />
					</div>
					<SpanHierarchyExplorer
						hierarchySpanId={hierarchySpanIdRef.current}
						selectedSpanId={selectedSpanId}
						onSelectSpan={selectSpanInCurrentTrace}
					/>
					<AttributeGrid
						title="Span Attributes"
						data={raw?.SpanAttributes}
					/>
					<AttributeGrid
						title="Resource Attributes"
						data={raw?.ResourceAttributes}
					/>
					<AttributeGrid title="Raw Record" data={raw} />
				</>
			)}
		</DetailShell>
	);
}

export default function TraceDetailPage({
	spanId,
	type,
}: {
	spanId: string;
	type: "traces" | "exceptions";
}) {
	return <TraceDetailView spanId={spanId} type={type} variant="page" />;
}
