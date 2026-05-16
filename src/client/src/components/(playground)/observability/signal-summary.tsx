"use client";

import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Activity, Layers3, Server, TrendingUp } from "lucide-react";
import { ObservabilitySignalConfig } from "./registry";
import getMessage from "@/constants/messages";

const m = getMessage();

type SummaryData = {
	bucket?: string;
	total?: number;
	peak?: number;
	buckets?: Array<Record<string, any>>;
};

function formatBucket(bucket?: string) {
	if (!bucket) return m.OBSERVABILITY_AUTO;
	return bucket.charAt(0).toUpperCase() + bucket.slice(1);
}

function chartColor(signal: ObservabilitySignalConfig["key"]) {
	if (signal === "exceptions") return "#e11d48";
	if (signal === "logs") return "#d97706";
	if (signal === "metrics") return "#059669";
	return "#0284c7";
}

function CompactStat({
	label,
	value,
	icon,
}: {
	label: string;
	value: string | number;
	icon: React.ReactNode;
}) {
	return (
		<div className="rounded-md border border-stone-200 bg-white px-3 py-2 dark:border-stone-800 dark:bg-stone-950">
			<div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
				{icon}
				{label}
			</div>
			<div className="mt-1 truncate text-sm font-semibold tabular-nums text-stone-950 dark:text-stone-50">
				{value}
			</div>
		</div>
	);
}

export default function SignalSummary({
	config,
	data,
	isLoading,
}: {
	config: ObservabilitySignalConfig;
	data?: SummaryData;
	isLoading?: boolean;
}) {
	const buckets = data?.buckets || [];
	const total = data?.total ?? buckets.reduce((sum, row) => sum + Number(row.count || 0), 0);
	const latest = buckets[buckets.length - 1] || {};
	const metricLabel =
		config.key === "metrics"
			? m.OBSERVABILITY_METRIC_POINTS
			: config.key === "logs"
				? m.OBSERVABILITY_LOG_EVENTS
				: m.OBSERVABILITY_SPANS;

	return (
		<section className="rounded-md border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-900/40">
			<div className="grid gap-3 xl:grid-cols-[1fr_420px]">
				<div className="min-w-0">
					<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
						<div>
							<p className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
								{formatBucket(data?.bucket)} volume
							</p>
							<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
								{metricLabel}
							</h2>
						</div>
						<span className={`rounded-full border px-2 py-1 text-xs font-medium ${config.tone}`}>
							{isLoading ? m.OBSERVABILITY_LOADING : `${buckets.length} buckets`}
						</span>
					</div>
					<div className="h-24 min-w-0">
						<ResponsiveContainer width="100%" height="100%">
							<BarChart data={buckets} margin={{ top: 2, right: 8, bottom: 0, left: -22 }}>
								<CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-stone-200 dark:stroke-stone-800" />
								<XAxis dataKey="label" tickLine={false} axisLine={false} className="text-[10px] fill-stone-500" />
								<YAxis tickLine={false} axisLine={false} className="text-[10px] fill-stone-500" />
								<Tooltip
									cursor={{ fill: "rgba(120, 113, 108, 0.12)" }}
									contentStyle={{
										borderRadius: 6,
										borderColor: "rgb(214 211 209)",
										fontSize: 12,
									}}
								/>
								<Bar dataKey="count" radius={[4, 4, 0, 0]} fill={chartColor(config.key)} />
							</BarChart>
						</ResponsiveContainer>
					</div>
				</div>
				<div className="grid grid-cols-2 gap-2 self-end">
					<CompactStat
						label={m.OBSERVABILITY_TOTAL}
						value={total.toLocaleString()}
						icon={<Activity className="h-3.5 w-3.5" />}
					/>
					<CompactStat
						label={m.OBSERVABILITY_PEAK}
						value={(data?.peak || 0).toLocaleString()}
						icon={<TrendingUp className="h-3.5 w-3.5" />}
					/>
					<CompactStat
						label={config.key === "metrics" ? m.OBSERVABILITY_METRICS : m.OBSERVABILITY_LATEST}
						value={Number(latest.metrics || latest.count || 0).toLocaleString()}
						icon={<Layers3 className="h-3.5 w-3.5" />}
					/>
					<CompactStat
						label={m.OBSERVABILITY_SERVICES}
						value={Number(latest.services || 0).toLocaleString()}
						icon={<Server className="h-3.5 w-3.5" />}
					/>
				</div>
			</div>
		</section>
	);
}
