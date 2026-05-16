"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Activity, Database, Server } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import DetailShell from "./detail-shell";
import AttributeGrid from "./attribute-grid";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";

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

	const points = ((data as any)?.points || []) as any[];
	const latest = points[0];
	const latestValue = latest?.metric_value;
	const unit = latest?.MetricUnit || m.OBSERVABILITY_VALUE;
	const pointCount = points.length;
	const lastSeen = latest?.TimeUnix;

	const goBack = () => {
		router.push(from || "/observability?tab=metrics");
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
						className="h-8 gap-1.5 px-2"
					>
						<ArrowLeft className="h-3.5 w-3.5" />
						{m.OBSERVABILITY_BACK}
					</Button>
				) : undefined
			}
			actions={extraActions}
			headerMeta={
				<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
					<SummaryItem
						icon={<Activity className="h-3.5 w-3.5" />}
						label={m.OBSERVABILITY_LATEST}
						value={
							typeof latestValue === "number"
								? latestValue.toLocaleString(undefined, { maximumFractionDigits: 4 })
								: latestValue
						}
					/>
					<SummaryItem
						icon={<Database className="h-3.5 w-3.5" />}
						label={m.OBSERVABILITY_UNIT}
						value={unit}
					/>
					<SummaryItem
						icon={<Database className="h-3.5 w-3.5" />}
						label={m.OBSERVABILITY_LOADED_POINTS}
						value={pointCount.toLocaleString()}
					/>
					<SummaryItem
						icon={<Server className="h-3.5 w-3.5" />}
						label={m.OBSERVABILITY_LAST_SEEN}
						value={lastSeen}
					/>
				</div>
			}
		>
			<AttributeGrid title={m.OBSERVABILITY_LATEST_METRIC_ATTRIBUTES} data={latest?.Attributes} />
			<AttributeGrid title={m.OBSERVABILITY_LATEST_RESOURCE_ATTRIBUTES} data={latest?.ResourceAttributes} />
			<AttributeGrid title={m.OBSERVABILITY_LATEST_SCOPE_ATTRIBUTES} data={latest?.ScopeAttributes} />
			<AttributeGrid title={m.OBSERVABILITY_LATEST_METRIC_POINT} data={latest} />
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
