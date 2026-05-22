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
	const metricLabel =
		config.key === "metrics"
			? m.OBSERVABILITY_METRIC_POINTS
			: config.key === "logs"
				? m.OBSERVABILITY_LOG_EVENTS
				: m.OBSERVABILITY_SPANS;

	return (
		<section className="rounded-md border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-900/40">
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
				<div className="h-28 min-w-0">
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
		</section>
	);
}
