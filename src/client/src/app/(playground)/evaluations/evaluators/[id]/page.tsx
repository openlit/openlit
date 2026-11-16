"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { round } from "lodash";
import {
	Activity,
	ArrowLeft,
	Banknote,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Settings2,
	XCircle,
} from "lucide-react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import Filter from "@/components/(playground)/filter";
import IntermediateState from "@/components/(playground)/intermediate-state";
import StatCard from "@/components/(playground)/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import getMessage from "@/constants/messages";
import { COLORS } from "../../../../../../styles/colors";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";
import { getPingStatus } from "@/selectors/database-config";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import type {
	EvaluationAnalyticsRecentResult,
	EvaluationEvaluatorAnalyticsResponse,
} from "@/types/evaluation";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";

type ChartMode = "passRate" | "executions";

type RecentResultRow = EvaluationAnalyticsRecentResult & { rowKey: string };

const RESULT_VISIBLE_COLUMNS = {
	expand: true,
	time: true,
	classification: true,
	verdict: true,
	score: true,
	source: true,
	spanId: true,
	cost: true,
};

const HEADER_TONE =
	"border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/40 dark:text-orange-300";

function severityScoreClass(score: number) {
	// Score is severity (0 = clean / pass, higher = worse) — inverse of pass-rate coloring.
	if (score <= 0.25) return "text-emerald-600 dark:text-emerald-400";
	if (score <= 0.5) return "text-lime-600 dark:text-lime-400";
	return "text-amber-600 dark:text-amber-400";
}

export default function EvaluationEvaluatorDetailPage() {
	const m = getMessage();
	const params = useParams();
	const evaluatorId = decodeURIComponent(String(params.id || ""));
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const [chartMode, setChartMode] = useState<ChartMode>("passRate");
	const [expandedKey, setExpandedKey] = useState<string | null>(null);
	const expandedRowRef = useRef<HTMLDivElement | null>(null);

	const { data, isLoading, isFetched, fireRequest, error } =
		useFetchWrapper<EvaluationEvaluatorAnalyticsResponse>();

	const fetchData = useCallback(() => {
		if (!evaluatorId) return;
		fireRequest({
			body: JSON.stringify(getFilterParamsForDashboard(filter)),
			requestType: "POST",
			url: `/api/evaluation/analytics/${encodeURIComponent(evaluatorId)}`,
		});
	}, [evaluatorId, filter, fireRequest]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		) {
			fetchData();
		}
	}, [filter, fetchData, pingStatus]);

	useEffect(() => {
		if (!expandedKey) return;
		expandedRowRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "nearest",
		});
	}, [expandedKey]);

	const metricsUrl = `/api/evaluation/analytics/${encodeURIComponent(evaluatorId)}`;
	const chartData = useMemo(
		() =>
			((data?.timeseries as any[]) || []).map((row) => ({
				request_time: row.timestamp,
				passRate: Number(row.passRate) || 0,
				executions: Number(row.executions) || 0,
			})),
		[data?.timeseries]
	);

	const recentResults: RecentResultRow[] = useMemo(
		() =>
			(data?.recentResults || []).map((result, index) => ({
				...result,
				rowKey: `${result.id}-${result.spanId}-${result.createdAt}-${index}`,
			})),
		[data?.recentResults]
	);

	const resultColumns: Columns<string, RecentResultRow> = useMemo(
		() => ({
			expand: {
				header: () => <span className="sr-only">{m.EVALUATION_EXPLANATION}</span>,
				width: "2.75rem",
				cell: ({ row }) => {
					const isOpen = expandedKey === row.rowKey;
					return (
						<span
							className="inline-flex h-5 w-5 items-center justify-center text-stone-500 dark:text-stone-400"
							aria-hidden
						>
							{isOpen ? (
								<ChevronDown className="h-3.5 w-3.5" />
							) : (
								<ChevronRight className="h-3.5 w-3.5" />
							)}
						</span>
					);
				},
			},
			time: {
				header: () => m.OBSERVABILITY_TIME,
				width: "minmax(10rem, 1.2fr)",
				cell: ({ row }) => (
					<span className="whitespace-nowrap tabular-nums text-stone-600 dark:text-stone-300">
						{row.createdAt}
					</span>
				),
			},
			classification: {
				header: () => m.EVALUATION_CLASSIFICATION,
				cell: ({ row }) => (
					<span className="block truncate font-medium text-stone-900 dark:text-stone-100">
						{row.classification || "—"}
					</span>
				),
			},
			verdict: {
				header: () => m.EVALUATION_VERDICT,
				width: "minmax(5rem, 0.6fr)",
				cell: ({ row }) => {
					const passed = row.verdict !== "yes";
					return (
						<span
							className={`font-medium ${
								passed
									? "text-emerald-600 dark:text-emerald-400"
									: "text-amber-600 dark:text-amber-400"
							}`}
						>
							{passed ? m.EVALUATION_DETAIL_PASS : m.EVALUATION_DETAIL_FAIL}
						</span>
					);
				},
			},
			score: {
				header: () => m.EVALUATION_SCORE,
				width: "minmax(5rem, 0.6fr)",
				className: "text-right",
				cell: ({ row }) => (
					<span
						className={`font-medium tabular-nums ${severityScoreClass(
							Number(row.score) || 0
						)}`}
					>
						{round(row.score, 2)}
					</span>
				),
			},
			source: {
				header: () => m.EVALUATION_SOURCE,
				cell: ({ row }) => (
					<span className="block truncate text-stone-600 dark:text-stone-300">
						{row.source || "—"}
					</span>
				),
			},
			spanId: {
				header: () => m.OBSERVABILITY_SPAN_ID,
				cell: ({ row }) =>
					row.spanId ? (
						<Link
							href={`/telemetry?traceId=${encodeURIComponent(row.spanId)}`}
							className="font-mono text-xs text-primary hover:underline"
							onClick={(e) => e.stopPropagation()}
						>
							{row.spanId.slice(0, 12)}
							{row.spanId.length > 12 ? "…" : ""}
						</Link>
					) : (
						<span className="font-mono text-xs">—</span>
					),
			},
			cost: {
				header: () => m.COST,
				width: "minmax(6rem, 0.7fr)",
				className: "text-right",
				cell: ({ row }) => (
					<span className="tabular-nums text-stone-600 dark:text-stone-300">
						{row.cost ? `$${round(row.cost, 6)}` : "—"}
					</span>
				),
			},
		}),
		[expandedKey, m]
	);
	const loading = isLoading || !isFetched || pingStatus === "pending";
	const notFound = isFetched && (error || (data && !data.found));
	const backLabel = m.EVALUATION_BACK_TO_ANALYTICS;

	const header = (
		<FeaturePageHeader
			eyebrow={m.FEATURE_EVALS}
			title={data?.evaluator?.label || evaluatorId}
			icon={<Activity className="h-4 w-4" />}
			tone={HEADER_TONE}
			description={data?.evaluator?.description}
			leading={
				<Button
					asChild
					variant="outline"
					size="sm"
					className="h-7 w-7 shrink-0 p-0"
				>
					<Link href="/evaluations" title={backLabel} aria-label={backLabel}>
						<ArrowLeft className="h-3.5 w-3.5" />
					</Link>
				</Button>
			}
			actions={
				<div className="flex flex-wrap items-center gap-2">
					{data?.evaluator ? (
						<Badge
							variant={data.evaluator.enabled ? "default" : "secondary"}
							className="h-7"
						>
							{data.evaluator.enabled
								? m.EVALUATION_DETAIL_ENABLED
								: m.EVALUATION_DETAIL_DISABLED}
						</Badge>
					) : null}
					<Button asChild variant="outline" size="sm" className="h-8">
						<Link
							href={`/evaluations/types/${encodeURIComponent(evaluatorId)}`}
						>
							<Settings2 className="mr-1.5 h-3.5 w-3.5" />
							{m.EVALUATION_DETAIL_CONFIGURE}
						</Link>
					</Button>
				</div>
			}
		/>
	);

	if (notFound) {
		return (
			<div className="flex h-full w-full flex-col overflow-hidden">
				{header}
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
					<p className="text-base font-medium text-stone-800 dark:text-stone-200">
						{m.EVALUATION_TYPE_NOT_FOUND}
					</p>
					<p className="max-w-md text-sm text-stone-500 dark:text-stone-400">
						{m.EVALUATION_TYPE_NOT_FOUND_DESCRIPTION}
					</p>
					<Button asChild variant="outline" size="sm" className="h-8">
						<Link href="/evaluations">{backLabel}</Link>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			{header}
			<div className="flex items-center justify-end border-b border-stone-200 px-4 py-2 dark:border-stone-800">
				<Filter />
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-24">
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<StatCard
						dataKey="executions"
						heading={m.EVALUATION_STAT_EXECUTIONS}
						icon={Activity}
						url={metricsUrl}
						roundTo={0}
					/>
					<StatCard
						dataKey="avg_pass_rate"
						heading={m.EVALUATION_STAT_AVG_PASS_RATE}
						icon={CheckCircle2}
						url={metricsUrl}
						textSuffix="%"
						roundTo={0}
					/>
					<StatCard
						dataKey="failed_scores"
						heading={m.EVALUATION_STAT_FAILED_SCORES}
						icon={XCircle}
						url={metricsUrl}
						roundTo={0}
					/>
					<StatCard
						dataKey="total_cost"
						heading={m.EVALUATION_STAT_TOTAL_COST}
						icon={Banknote}
						url={metricsUrl}
						textPrefix="$"
						roundTo={4}
					/>
				</div>

				<Card className="border border-stone-200 dark:border-stone-800">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => setChartMode("passRate")}
								className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
									chartMode === "passRate"
										? "border-stone-300 bg-stone-100 text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
										: "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
								}`}
							>
								{m.EVALUATION_CHART_PASS_RATE}
							</button>
							<button
								type="button"
								onClick={() => setChartMode("executions")}
								className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
									chartMode === "executions"
										? "border-stone-300 bg-stone-100 text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
										: "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
								}`}
							>
								{m.EVALUATION_CHART_EXECUTIONS}
							</button>
						</div>
					</CardHeader>
					<CardContent>
						<ResponsiveContainer className="h-48" width="100%" height={192}>
							{loading ? (
								<IntermediateState type="loading" classNames="h-48" />
							) : chartData.length === 0 ? (
								<IntermediateState type="nodata" classNames="h-48" />
							) : (
								<LineChart
									data={chartData}
									margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
								>
									<CartesianGrid strokeDasharray="3 3" />
									<XAxis
										dataKey="request_time"
										className="text-xs stroke-stone-300"
										stroke="currentColor"
									/>
									<YAxis
										className="text-xs stroke-stone-300"
										stroke="currentColor"
										domain={
											chartMode === "passRate" ? [0, 100] : [0, "dataMax + 15"]
										}
									/>
									<Tooltip labelClassName="dark:text-stone-700" />
									<Line
										type="monotone"
										dataKey={
											chartMode === "passRate" ? "passRate" : "executions"
										}
										stroke={`${COLORS.primary}`}
										activeDot={{ r: 4 }}
									/>
								</LineChart>
							)}
						</ResponsiveContainer>
					</CardContent>
				</Card>

				<div className="flex shrink-0 flex-col gap-2">
					<h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">
						{m.EVALUATION_DETAIL_RECENT_RESULTS}
					</h2>
					<DataTable
						columns={resultColumns}
						data={recentResults}
						isFetched={isFetched && pingStatus !== "pending"}
						isLoading={isLoading}
						visibilityColumns={RESULT_VISIBLE_COLUMNS}
						getRowKey={(row: RecentResultRow) => row.rowKey}
						onClick={(row: RecentResultRow) =>
							setExpandedKey(expandedKey === row.rowKey ? null : row.rowKey)
						}
						renderExpandedRow={(row: RecentResultRow) =>
							expandedKey === row.rowKey ? (
								<div ref={expandedRowRef}>
									<p className="mb-1 text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
										{m.EVALUATION_EXPLANATION}
									</p>
									<p className="whitespace-pre-wrap break-words">
										{row.explanation?.trim() ? row.explanation : "—"}
									</p>
								</div>
							) : null
						}
						emptyState={
							<IntermediateState type="nodata">
								{m.EVALUATION_DETAIL_NO_RESULTS}
							</IntermediateState>
						}
					/>
				</div>
			</div>
		</div>
	);
}
