"use client";

import { useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import DetailShell from "./detail-shell";
import AttributeGrid from "./attribute-grid";

export default function MetricDetailPage({ name }: { name: string }) {
	const searchParams = useSearchParams();
	const metricType = searchParams.get("metricType") || undefined;
	const serviceName = searchParams.get("serviceName") || undefined;
	const filter = useRootStore(getFilterDetails);
	const { data, fireRequest } = useFetchWrapper();

	const fetchData = useCallback(() => {
		fireRequest({
			requestType: "POST",
			url: `/api/observability/metrics/${encodeURIComponent(name)}`,
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

	const series = ((data as any)?.series || []) as any[];
	const points = ((data as any)?.points || []) as any[];
	const latest = points[0];

	return (
		<DetailShell
			title={name}
			subtitle={`${metricType || "metric"} / ${serviceName || "all services"}`}
		>
			<section className="h-72 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-3">
				<ResponsiveContainer width="100%" height="100%">
					<LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
						<CartesianGrid strokeDasharray="3 3" />
						<XAxis dataKey="request_time" className="text-xs stroke-stone-300" stroke="currentColor" />
						<YAxis className="text-xs stroke-stone-300" stroke="currentColor" />
						<Tooltip labelClassName="dark:text-stone-700" />
						<Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" dot={false} />
					</LineChart>
				</ResponsiveContainer>
			</section>
			<AttributeGrid title="Latest Metric Attributes" data={latest?.Attributes} />
			<AttributeGrid title="Latest Resource Attributes" data={latest?.ResourceAttributes} />
			<AttributeGrid title="Latest Scope Attributes" data={latest?.ScopeAttributes} />
		</DetailShell>
	);
}
