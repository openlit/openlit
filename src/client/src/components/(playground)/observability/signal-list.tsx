"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TracesFilter from "@/components/(playground)/filter/traces-filter";
import GroupBreadcrumb from "@/components/(playground)/request/group-breadcrumb";
import GroupedTable, {
	buildGroupValueFilter,
} from "@/components/(playground)/request/grouped-table";
import { getPingStatus } from "@/selectors/database-config";
import {
	getFilterDetails,
	getUpdateConfig,
	getUpdateFilter,
} from "@/selectors/filter";
import { getVisibilityColumnsOfPage } from "@/selectors/page";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { ObservabilitySignalConfig } from "./registry";
import SignalSummary from "./signal-summary";
import SignalRecords from "./signal-records";
import { TraceDetailView } from "./trace-detail-page";
import { MetricDetailView } from "./metric-detail-page";
import { LogDetailView } from "./log-detail-page";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Maximize2, X } from "lucide-react";
import getMessage from "@/constants/messages";
import { prepareObservabilitySignalChange } from "@/helpers/client/observability";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";

const DETAIL_SHEET_CONTENT_CLASS =
	"right-2 top-2 bottom-2 flex h-auto w-auto max-w-none flex-col gap-0 border-0 bg-transparent p-0 shadow-none focus-visible:outline-none sm:max-w-none";

function ResizableDetailSheet({
	children,
}: {
	children: ReactNode;
}) {
	const [maxWidth, setMaxWidth] = useState(1200);
	const [defaultWidth, setDefaultWidth] = useState(760);

	useEffect(() => {
		const updateBounds = () => {
			const viewportWidth = window.innerWidth;
			const nextMaxWidth = Math.max(420, viewportWidth - 32);
			setMaxWidth(nextMaxWidth);
			setDefaultWidth(Math.min(Math.max(viewportWidth * 0.68, 860), nextMaxWidth));
		};
		updateBounds();
		window.addEventListener("resize", updateBounds);
		return () => window.removeEventListener("resize", updateBounds);
	}, []);

	return (
		<ResizeablePanel
			defaultWidth={defaultWidth}
			minWidth={420}
			maxWidth={maxWidth}
			handlePosition="left"
			className="h-full max-w-[calc(100vw-1rem)] rounded-md bg-white shadow-2xl dark:bg-stone-950"
			handleClassName="opacity-100 border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
		>
			<div className="flex h-full min-h-0 flex-col overflow-hidden">
				{children}
			</div>
		</ResizeablePanel>
	);
}

export default function ObservabilitySignalList({
	config,
	runFilters,
	toolbarExtraControls,
}: {
	config: ObservabilitySignalConfig;
	// runFilters is a per-render filter slice that callers pin onto the
	// list/summary requests (e.g. an agent-scoped sessions tab pins
	// `vendor`, the per-user page pins `user`). We forward them as-is
	// inside the POST body so the route handler picks them up without
	// the global filter store needing to know about coding-agent
	// concepts.
	runFilters?: Record<string, unknown>;
	// `toolbarExtraControls` are rendered immediately to the LEFT of
	// the filter (`SlidersHorizontal`) button. Coding-agent tabs use
	// this to inject a per-user picker into the same toolbar without
	// the inline filter bar above the table.
	toolbarExtraControls?: ReactNode;
}) {
	const m = getMessage();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);
	const updateConfig = useRootStore(getUpdateConfig);
	const pingStatus = useRootStore(getPingStatus);
	const visibilityColumns = useRootStore((state) =>
		getVisibilityColumnsOfPage(state, config.visibilityPage)
	);
	const [previewSpanId, setPreviewSpanId] = useState<string | null>(null);
	const skipSelectedHydrationRef = useRef(false);
	const selectedParam = searchParams.get("selected");
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const {
		data: summaryData,
		fireRequest: fireSummaryRequest,
		isLoading: isSummaryLoading,
	} = useFetchWrapper();

	useEffect(() => {
		prepareObservabilitySignalChange(updateConfig, updateFilter);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [config.key]);

	const effectiveFilter = useMemo(() => {
		const base =
			filter.groupBy && filter.groupValue
				? {
						...filter,
						selectedConfig: buildGroupValueFilter(
							filter.groupBy,
							filter.groupValue,
							filter.selectedConfig
						),
					}
				: filter;
		// Pin caller-supplied filters under a stable key so route
		// handlers (and the cache key implicitly via JSON body) pick
		// them up. Stripping nullish entries keeps the cache key stable
		// when a caller toggles a filter on/off.
		if (runFilters && Object.keys(runFilters).length > 0) {
			const cleaned = Object.fromEntries(
				Object.entries(runFilters).filter(
					([, value]) => value !== undefined && value !== null && value !== ""
				)
			);
			if (Object.keys(cleaned).length > 0) {
				return { ...base, runFilters: cleaned };
			}
		}
		return base;
	}, [filter, runFilters]);

	const showFlatList =
		!config.supportGrouping || !filter.groupBy || !!filter.groupValue;

	const fetchData = useCallback(() => {
		fireRequest({
			body: JSON.stringify(effectiveFilter),
			requestType: "POST",
			url: config.listUrl,
			failureCb: (err?: string) => {
				toast.error(err || m.OBSERVABILITY_NO_SERVER_CONNECTION, {
					id: `observability-${config.key}`,
				});
			},
		});
	}, [config.key, config.listUrl, effectiveFilter, fireRequest, m.OBSERVABILITY_NO_SERVER_CONNECTION]);

	const fetchSummary = useCallback(() => {
		fireSummaryRequest({
			body: JSON.stringify(effectiveFilter),
			requestType: "POST",
			url: config.summaryUrl,
		});
	}, [config.summaryUrl, effectiveFilter, fireSummaryRequest]);

	useEffect(() => {
		if (
			effectiveFilter.filterReady &&
			effectiveFilter.timeLimit.start &&
			effectiveFilter.timeLimit.end &&
			pingStatus === "success"
		) {
			fetchSummary();
			if (showFlatList) fetchData();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [effectiveFilter, pingStatus, showFlatList]);

	const rows = useMemo(() => {
		const records = (data as any)?.records || [];
		return config.normalize ? records.map(config.normalize) : records;
	}, [config, data]);
	const total = (data as any)?.total || 0;
	const isTraceSignal = config.key === "traces" || config.key === "exceptions";
	const isMetricSignal = config.key === "metrics";
	const isLogSignal = config.key === "logs";
	// Coding-agent sessions render through the same TraceDetailView used
	// for trace/exception signals — Phase 2 of the coding-agents work
	// makes the session-root SpanId stable, so opening that SpanId in
	// the trace detail sheet shows the full session as one trace tree.
	const isSessionSignal = config.key === "sessions";

	const setSelectedInUrl = useCallback(
		(id: string | null) => {
			const params = new URLSearchParams(searchParams.toString());
			if (id) {
				params.set("selected", id);
			} else {
				params.delete("selected");
			}
			const query = params.toString();
			router.replace(`${pathname}${query ? `?${query}` : ""}`, {
				scroll: false,
			});
		},
		[pathname, router, searchParams]
	);

	const closePreview = useCallback(() => {
		skipSelectedHydrationRef.current = true;
		setPreviewSpanId(null);
		setSelectedInUrl(null);
	}, [setSelectedInUrl]);

	useEffect(() => {
		if (!selectedParam) {
			skipSelectedHydrationRef.current = false;
			setPreviewSpanId(null);
			return;
		}
		if (
			(isTraceSignal || isSessionSignal) &&
			!previewSpanId &&
			!skipSelectedHydrationRef.current
		) {
			setPreviewSpanId(selectedParam);
			return;
		}
		if (!isTraceSignal && !isSessionSignal) setPreviewSpanId(null);
	}, [isTraceSignal, isSessionSignal, previewSpanId, selectedParam]);

	const selectedMetricRow = useMemo(() => {
		if (!isMetricSignal || !selectedParam) return null;
		return (
			rows.find((row: any) => config.getRowId(row) === selectedParam) || null
		);
	}, [config, isMetricSignal, rows, selectedParam]);

	const selectedLogRow = useMemo(() => {
		if (!isLogSignal || !selectedParam) return null;
		return (
			rows.find((row: any) => config.getRowId(row) === selectedParam) || null
		);
	}, [config, isLogSignal, rows, selectedParam]);

	const openDetail = (row: any) => {
		if (isLoading) return;
		if (isTraceSignal) {
			skipSelectedHydrationRef.current = false;
			setPreviewSpanId(row.spanId);
			setSelectedInUrl(row.spanId);
			return;
		}
		if (isSessionSignal) {
			// TraceDetailView opens on a SpanId. Prefer the explicit
			// session-root SpanId (post-Phase-2 the CLI derives this
			// deterministically from the session id); fall back to the
			// chronologically-first child span; final fallback is the
			// session id itself, which the trace detail page handles
			// gracefully by surfacing an empty trace state.
			const safe = row && typeof row === "object" ? row : {};
			const targetSpanId =
				safe.session_root_span_id || safe.session_id || safe.trace_id || "";
			if (!targetSpanId) return;
			skipSelectedHydrationRef.current = false;
			setPreviewSpanId(targetSpanId);
			setSelectedInUrl(targetSpanId);
			return;
		}
		if (isMetricSignal) {
			setSelectedInUrl(config.getRowId(row));
			return;
		}
		if (isLogSignal) {
			setSelectedInUrl(config.getRowId(row));
			return;
		}
		const from = `${window.location.pathname}${window.location.search}`;
		router.push(config.getDetailHref(row, from));
	};

	const previewHref = useMemo(() => {
		const activeSpanId = selectedParam || previewSpanId;
		if (!activeSpanId) return "";
		const from =
			typeof window !== "undefined"
				? `${window.location.pathname}${window.location.search}`
				: "/telemetry";
		const prefix =
			config.key === "exceptions"
				? "/telemetry/exceptions"
				: "/telemetry/traces";
		return `${prefix}/${activeSpanId}?from=${encodeURIComponent(from)}`;
	}, [config.key, previewSpanId, selectedParam]);

	const metricPreviewHref = useMemo(() => {
		if (!selectedMetricRow) return "";
		const from =
			typeof window !== "undefined"
				? `${window.location.pathname}${window.location.search}`
				: "/telemetry?tab=metrics";
		return config.getDetailHref(selectedMetricRow, from);
	}, [config, selectedMetricRow]);

	const logPreviewHref = useMemo(() => {
		if (!selectedLogRow) return "";
		const from =
			typeof window !== "undefined"
				? `${window.location.pathname}${window.location.search}`
				: "/telemetry?tab=logs";
		return config.getDetailHref(selectedLogRow, from);
	}, [config, selectedLogRow]);

	const updateTraceSelection = useCallback(
		(spanId: string) => {
			skipSelectedHydrationRef.current = false;
			setPreviewSpanId(spanId);
			setSelectedInUrl(spanId);
		},
		[setSelectedInUrl]
	);

	const updateActiveTraceSelection = useCallback(
		(spanId: string) => {
			// Drilling into a child span inside an open SESSION must not
			// rewrite the URL. A coding-agent session is one logical unit:
			// `?selected=` stays pinned to the session-root SpanId so (a)
			// the session row keeps its highlight and (b) the list subtree
			// doesn't re-render on every span click — that re-render was the
			// row "flicker". The active inner span is tracked entirely by
			// TraceDetailView's own `selectedSpanId` state, which is all the
			// detail panel + AI analysis tab consume; the URL only needs the
			// session-level entry point. Trace/exception signals keep writing
			// the active span so per-span deep-links there still work.
			if (isSessionSignal) return;
			setSelectedInUrl(spanId);
		},
		[isSessionSignal, setSelectedInUrl]
	);

	const updateTraceNavigationPage = useCallback(
		(offset: number) => {
			updateFilter("offset", offset);
		},
		[updateFilter]
	);

	return (
		<>
			<div className="mb-3">
				<SignalSummary
					key={`summary-${config.key}`}
					config={config}
					data={summaryData as any}
					isLoading={isSummaryLoading || pingStatus === "pending"}
				/>
			</div>
			<TracesFilter
				total={showFlatList ? total : undefined}
				supportDynamicFilters
				includeOnlySorting={config.includeOnlySorting}
				customSortOptions={config.customSortOptions}
				pageName={config.pageName}
				columns={config.columns}
				configUrl={config.configUrl}
				attributeKeysUrl={config.attributeKeysUrl}
				customAttributeTypes={config.customAttributeTypes}
				filterStorageScope={config.key}
				showGroupBy={!!config.supportGrouping}
				showVisibilityColumns
				extraControls={toolbarExtraControls}
			/>

			{config.supportGrouping && filter.groupBy && (
				<GroupBreadcrumb
					groupBy={filter.groupBy}
					groupValue={filter.groupValue}
					rootLabel={`All ${config.label}`}
					updateFilter={updateFilter}
				/>
			)}

			{config.supportGrouping && filter.groupBy && !filter.groupValue ? (
				<GroupedTable
					groupBy={filter.groupBy}
					apiUrl={config.groupedUrl}
				/>
			) : (
				<div className="flex min-h-0 flex-col gap-4">
					<SignalRecords
						key={`records-${config.key}`}
						config={config}
						rows={rows}
						visibilityColumns={visibilityColumns}
						isFetched={isFetched || pingStatus !== "pending"}
						isLoading={isLoading || pingStatus === "pending"}
						onOpen={openDetail}
						// For sessions, the row highlight tracks the OPEN session
						// (its root span id, held in `previewSpanId`), not the
						// live `?selected=` value. Drilling into a child span
						// (chat message, llm.turn, tool.call) rewrites `?selected=`
						// to that child's id, which would otherwise drop the
						// session row's highlight on every click — the flicker the
						// row exhibited. Trace/exception signals keep matching the
						// live selection.
						selectedId={
							isSessionSignal ? previewSpanId || selectedParam : selectedParam
						}
					/>
				</div>
			)}
			<Sheet
				modal={false}
				open={(isTraceSignal || isSessionSignal) && !!previewSpanId}
				onOpenChange={(open) => !open && closePreview()}
			>
				<SheetContent
					side="right"
					className={DETAIL_SHEET_CONTENT_CLASS}
					displayOverlay={false}
					displayClose={false}
				>
					<ResizableDetailSheet>
						<div className="min-h-0 flex-1 overflow-hidden">
							{previewSpanId && (
								<TraceDetailView
									spanId={previewSpanId}
									type={config.key === "exceptions" ? "exceptions" : "traces"}
									variant="sheet"
									onSpanChange={updateTraceSelection}
									onActiveSpanChange={updateActiveTraceSelection}
									onNavigationPageChange={updateTraceNavigationPage}
									navigationRows={rows}
									navigationOffset={filter.offset}
									navigationTotal={total}
									navigationFilter={effectiveFilter}
									extraActions={
										<>
											<Button
												variant="outline"
												size="sm"
												className="h-7 gap-1.5"
												onClick={() => router.push(previewHref)}
												disabled={!previewHref}
											>
												<Maximize2 className="h-3.5 w-3.5" />
												{m.OBSERVABILITY_FULL_SCREEN}
											</Button>
											<Button
												variant="outline"
												size="sm"
												className="h-7 w-7 p-0 border-stone-200 bg-white text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
												onClick={closePreview}
												title={m.OBSERVABILITY_CLOSE}
											>
												<X className="h-4 w-4" />
											</Button>
										</>
									}
								/>
							)}
						</div>
					</ResizableDetailSheet>
				</SheetContent>
			</Sheet>
			<Sheet
				modal={false}
				open={isMetricSignal && !!selectedMetricRow}
				onOpenChange={(open) => !open && closePreview()}
			>
				<SheetContent
					side="right"
					className={DETAIL_SHEET_CONTENT_CLASS}
					displayOverlay={false}
					displayClose={false}
				>
					<ResizableDetailSheet>
						<div className="min-h-0 flex-1 overflow-hidden">
							{selectedMetricRow && (
								<MetricDetailView
									name={selectedMetricRow.metricName}
									metricType={selectedMetricRow.metricType}
									serviceName={selectedMetricRow.serviceName}
									variant="sheet"
									extraActions={
										<div className="flex items-center gap-2">
											<Button
												variant="outline"
												size="sm"
												className="h-7 gap-1.5"
												onClick={() => router.push(metricPreviewHref)}
												disabled={!metricPreviewHref}
											>
												<Maximize2 className="h-3.5 w-3.5" />
												{m.OBSERVABILITY_FULL_SCREEN}
											</Button>
											<Button
												variant="outline"
												size="sm"
												className="h-7 w-7 p-0 border-stone-200 bg-white text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
												onClick={closePreview}
												title={m.OBSERVABILITY_CLOSE}
											>
												<X className="h-4 w-4" />
											</Button>
										</div>
									}
								/>
							)}
						</div>
					</ResizableDetailSheet>
				</SheetContent>
			</Sheet>
			<Sheet
				modal={false}
				open={isLogSignal && !!selectedLogRow}
				onOpenChange={(open) => !open && closePreview()}
			>
				<SheetContent
					side="right"
					className={DETAIL_SHEET_CONTENT_CLASS}
					displayOverlay={false}
					displayClose={false}
				>
					<ResizableDetailSheet>
						<div className="min-h-0 flex-1 overflow-hidden">
							{selectedLogRow && (
								<LogDetailView
									id={config.getRowId(selectedLogRow)}
									from={
										typeof window !== "undefined"
											? `${window.location.pathname}${window.location.search}`
											: "/telemetry?tab=logs"
									}
									variant="sheet"
									extraActions={
										<div className="flex items-center gap-2">
											<Button
												variant="outline"
												size="sm"
												className="h-7 gap-1.5"
												onClick={() => router.push(logPreviewHref)}
												disabled={!logPreviewHref}
											>
												<Maximize2 className="h-3.5 w-3.5" />
												{m.OBSERVABILITY_FULL_SCREEN}
											</Button>
											<Button
												variant="outline"
												size="sm"
												className="h-7 w-7 p-0 border-stone-200 bg-white text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
												onClick={closePreview}
												title={m.OBSERVABILITY_CLOSE}
											>
												<X className="h-4 w-4" />
											</Button>
										</div>
									}
								/>
							)}
						</div>
					</ResizableDetailSheet>
				</SheetContent>
			</Sheet>
		</>
	);
}
