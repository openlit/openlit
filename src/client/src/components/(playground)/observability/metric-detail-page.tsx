"use client";

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Activity, Clock, Database, Sigma, TrendingUp } from "lucide-react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import DetailShell from "./detail-shell";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
import DetailObjectTabs, { buildObjectTabs } from "./detail-object-tabs";

function SummaryItem({
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
			<div className="mt-1 truncate text-sm font-semibold tabular-nums text-stone-950 dark:text-stone-50">
				{value || "-"}
			</div>
		</div>
	);
}

function toNumber(value: unknown) {
	const numberValue = typeof value === "number" ? value : Number(value);
	return Number.isFinite(numberValue) ? numberValue : undefined;
}

function formatMetricValue(value: unknown, maximumFractionDigits = 4) {
	const numberValue = toNumber(value);
	if (numberValue === undefined) return value ? String(value) : "-";
	return numberValue.toLocaleString(undefined, { maximumFractionDigits });
}

function compactPoint(point: any) {
	const attributes = point?.Attributes || {};
	return {
		Time: point?.TimeUnix,
		Value: point?.metric_value,
		Unit: point?.MetricUnit,
		Type: point?.metric_type,
		Samples: point?.metric_sample_count,
		Service: point?.ServiceName,
		Model: attributes.model,
		Source: attributes.query_source,
		Session: attributes["session.id"],
		Terminal: attributes["terminal.type"],
		Attributes: point?.Attributes,
		ResourceAttributes: point?.ResourceAttributes,
		ScopeAttributes: point?.ScopeAttributes,
	};
}

export function MetricDetailView({
	name,
	metricType,
	serviceName,
	from,
	variant = "page",
	extraActions,
}: {
	name: string;
	metricType?: string;
	serviceName?: string;
	from?: string | null;
	variant?: "page" | "sheet";
	extraActions?: ReactNode;
}) {
	const m = getMessage();
	const router = useRouter();
	const filter = useRootStore(getFilterDetails);
	const { data, fireRequest } = useFetchWrapper();

	const fetchData = useCallback(() => {
		fireRequest({
			requestType: "POST",
			url: `/api/telemetry/metrics/${encodeURIComponent(name)}`,
			body: JSON.stringify({
				timeLimit: filter.timeLimit,
				selectedConfig: filter.selectedConfig,
				metricType,
				serviceName,
			}),
		});
	}, [filter, fireRequest, metricType, name, serviceName]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const points = ((data as any)?.points || []) as any[];
	const series = ((data as any)?.series || []) as any[];
	const latest = points[0];
	const latestValue = latest?.metric_value;
	const unit = latest?.MetricUnit || m.OBSERVABILITY_VALUE;
	const pointCount = points.length;
	const lastSeen = latest?.TimeUnix;
	const pointValues = useMemo(
		() => points.map((point) => toNumber(point?.metric_value)).filter((value): value is number => value !== undefined),
		[points]
	);
	const totalValue = pointValues.reduce((total, value) => total + value, 0);
	const averageValue = pointValues.length ? totalValue / pointValues.length : undefined;
	const maxValue = pointValues.length ? Math.max(...pointValues) : undefined;
	const chartData = useMemo(
		() =>
			series
				.map((point) => ({
					time: point?.request_time,
					value: toNumber(point?.value),
				}))
				.filter((point) => point.time && point.value !== undefined),
		[series]
	);
	const detailTabs = useMemo(
		() => [
			...buildObjectTabs(latest, {
				labelOverrides: {
					Attributes: "Metric Attributes",
					ResourceAttributes: "Resource Attributes",
					ScopeAttributes: "Scope Attributes",
				},
			}),
			...(points.length
				? [{ id: "points", label: "Points", data: points.map(compactPoint) }]
				: []),
			...(series.length ? [{ id: "series", label: "Series", data: series }] : []),
		],
		[latest, points, series]
	);

	const goBack = () => {
		router.push(from || "/telemetry?tab=metrics");
	};

	return (
		<DetailShell
			title={name}
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
				<div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
					<SummaryItem
						icon={<Activity className="h-3.5 w-3.5" />}
						label={m.OBSERVABILITY_LATEST}
						value={formatMetricValue(latestValue)}
					/>
					<SummaryItem
						icon={<Sigma className="h-3.5 w-3.5" />}
						label="Total"
						value={pointValues.length ? formatMetricValue(totalValue) : "-"}
					/>
					<SummaryItem
						icon={<TrendingUp className="h-3.5 w-3.5" />}
						label="Average"
						value={averageValue !== undefined ? formatMetricValue(averageValue) : "-"}
					/>
					<SummaryItem
						icon={<Database className="h-3.5 w-3.5" />}
						label={`${m.OBSERVABILITY_LOADED_POINTS} (${unit})`}
						value={pointCount.toLocaleString()}
					/>
					<SummaryItem
						icon={<Clock className="h-3.5 w-3.5" />}
						label={m.OBSERVABILITY_LAST_SEEN}
						value={lastSeen}
					/>
				</div>
			}
		>
			{chartData.length > 0 && (
				<section className="rounded-md border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
					<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
						<div>
							<div className="text-sm font-semibold text-stone-950 dark:text-stone-50">
								Metric Trend
							</div>
							<div className="text-xs text-stone-500 dark:text-stone-400">
								{latest?.MetricDescription || latest?.MetricName || name}
							</div>
						</div>
						<div className="flex flex-wrap gap-2 text-xs">
							<span className="rounded-md border border-stone-200 px-2 py-1 font-mono text-stone-600 dark:border-stone-800 dark:text-stone-300">
								max {formatMetricValue(maxValue)}
							</span>
							<span className="rounded-md border border-stone-200 px-2 py-1 font-mono text-stone-600 dark:border-stone-800 dark:text-stone-300">
								unit {unit}
							</span>
						</div>
					</div>
					<div className="h-44 min-w-0">
						<ResponsiveContainer width="100%" height="100%">
							<AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
								<defs>
									<linearGradient id="metric-detail-fill" x1="0" y1="0" x2="0" y2="1">
										<stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.32} />
										<stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.02} />
									</linearGradient>
								</defs>
								<CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-stone-200 dark:text-stone-800" />
								<XAxis dataKey="time" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
								<YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => formatMetricValue(value, 2)} />
								<Tooltip
									formatter={(value) => [formatMetricValue(value), unit]}
									labelClassName="text-stone-500"
									contentStyle={{
										borderRadius: 6,
										borderColor: "rgb(214 211 209)",
										fontSize: 12,
									}}
								/>
								<Area
									type="monotone"
									dataKey="value"
									stroke="#0284c7"
									fill="url(#metric-detail-fill)"
									strokeWidth={2}
									dot={{ r: 2 }}
									activeDot={{ r: 4 }}
								/>
							</AreaChart>
						</ResponsiveContainer>
					</div>
				</section>
			)}
			<DetailObjectTabs tabs={detailTabs} />
		</DetailShell>
	);
}

export default function MetricDetailPage({ name }: { name: string }) {
	const searchParams = useSearchParams();

	return (
		<MetricDetailView
			name={name}
			metricType={searchParams.get("metricType") || undefined}
			serviceName={searchParams.get("serviceName") || undefined}
			from={searchParams.get("from")}
		/>
	);
}
