"use client";

import { useCallback, useEffect } from "react";
import { format, parseISO, isValid } from "date-fns";
import {
	Activity,
	BadgeCheck,
	CircleDollarSign,
	ScanSearch,
} from "lucide-react";
import StatCard from "@/components/(playground)/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import getMessage from "@/constants/messages";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";
import { getFilterDetails } from "@/selectors/filter";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import type { PricingCronRunRow } from "@/lib/platform/pricing/cron-analytics";

type PricingCronAnalyticsResponse = {
	data?: Array<Record<string, number>>;
	runs?: PricingCronRunRow[];
	err?: unknown;
};

function formatStartedAt(value: string) {
	try {
		const date = parseISO(value.includes("T") ? value : value.replace(" ", "T"));
		if (!isValid(date)) return value;
		return format(date, "yyyy-MM-dd HH:mm:ss");
	} catch {
		return value;
	}
}

function statusClass(status: string) {
	if (status === "SUCCESS") {
		return "text-emerald-700 dark:text-emerald-300";
	}
	if (status === "PARTIAL_SUCCESS") {
		return "text-amber-700 dark:text-amber-300";
	}
	if (status === "FAILURE") {
		return "text-red-700 dark:text-red-300";
	}
	return "text-stone-600 dark:text-stone-300";
}

export default function AutoPricingRuns({
	onConfigure,
}: {
	onConfigure: () => void;
}) {
	const m = getMessage();
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } =
		useFetchWrapper<PricingCronAnalyticsResponse>();

	const fetchData = useCallback(() => {
		fireRequest({
			body: JSON.stringify({
				...getFilterParamsForDashboard(filter),
				limit: 25,
			}),
			requestType: "POST",
			url: "/api/pricing/cron-analytics",
		});
	}, [filter, fireRequest]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		) {
			fetchData();
		}
	}, [filter, fetchData, pingStatus]);

	const loading = isLoading || !isFetched || pingStatus === "pending";
	const runs = data?.runs || [];
	const summary = data?.data?.[0];
	const totalRuns = Number(summary?.total_runs) || 0;
	const summaryUrl = "/api/pricing/cron-analytics";

	return (
		<div className="flex flex-col gap-3">
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<StatCard
					dataKey="total_runs"
					heading={m.COSTS_STAT_CRON_RUNS}
					icon={Activity}
					url={summaryUrl}
					roundTo={0}
				/>
				<StatCard
					dataKey="successful_runs"
					heading={m.COSTS_STAT_CRON_SUCCESS}
					icon={BadgeCheck}
					url={summaryUrl}
					roundTo={0}
				/>
				<StatCard
					dataKey="total_updated"
					heading={m.COSTS_STAT_PRICING_APPLIED}
					icon={CircleDollarSign}
					url={summaryUrl}
					roundTo={0}
				/>
				<StatCard
					dataKey="total_spans"
					heading={m.COSTS_STAT_SPANS_SCANNED}
					icon={ScanSearch}
					url={summaryUrl}
					roundTo={0}
				/>
			</div>

			<Card className="overflow-hidden border-stone-200 shadow-sm dark:border-stone-800">
				<CardContent className="p-0">
					{loading ? (
						<div className="p-4">
							<Skeleton className="h-24 w-full" />
						</div>
					) : runs.length === 0 ? (
						<div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center">
							<p className="text-sm text-stone-500 dark:text-stone-400">
								{m.COSTS_CRON_TABLE_EMPTY}
							</p>
							{totalRuns === 0 ? (
								<>
									<p className="max-w-md text-xs text-stone-400 dark:text-stone-500">
										{m.COSTS_CRON_TABLE_EMPTY_HINT}
									</p>
									<Button size="sm" onClick={onConfigure}>
										{m.COSTS_CRON_TABLE_EMPTY_CTA}
									</Button>
								</>
							) : null}
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-y border-stone-200 text-left text-[11px] uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:text-stone-400">
										<th className="px-4 py-2 font-medium">
											{m.COSTS_CRON_TABLE_STARTED}
										</th>
										<th className="px-4 py-2 font-medium">
											{m.COSTS_CRON_TABLE_STATUS}
										</th>
										<th className="px-4 py-2 font-medium text-right">
											{m.COSTS_CRON_TABLE_DURATION}
										</th>
										<th className="px-4 py-2 font-medium text-right">
											{m.COSTS_CRON_TABLE_UPDATED}
										</th>
										<th className="px-4 py-2 font-medium text-right">
											{m.COSTS_CRON_TABLE_SCANNED}
										</th>
										<th className="px-4 py-2 font-medium text-right">
											{m.COSTS_CRON_TABLE_SKIPPED}
										</th>
										<th className="px-4 py-2 font-medium text-right">
											{m.COSTS_CRON_TABLE_FAILED}
										</th>
									</tr>
								</thead>
								<tbody>
									{runs.map((row, index) => (
										<tr
											key={`${row.startedAt}-${index}`}
											className="border-b border-stone-100 hover:bg-stone-50 dark:border-stone-900 dark:hover:bg-stone-900/50"
										>
											<td className="px-4 py-2.5 tabular-nums text-stone-800 dark:text-stone-200">
												{formatStartedAt(row.startedAt)}
											</td>
											<td
												className={`px-4 py-2.5 text-xs font-medium ${statusClass(row.runStatus)}`}
											>
												{row.runStatus}
											</td>
											<td className="px-4 py-2.5 text-right tabular-nums text-stone-800 dark:text-stone-200">
												{row.duration.toLocaleString()}s
											</td>
											<td className="px-4 py-2.5 text-right tabular-nums font-medium text-stone-900 dark:text-stone-100">
												{row.totalUpdated.toLocaleString()}
											</td>
											<td className="px-4 py-2.5 text-right tabular-nums text-stone-800 dark:text-stone-200">
												{row.totalSpans.toLocaleString()}
											</td>
											<td className="px-4 py-2.5 text-right tabular-nums text-stone-800 dark:text-stone-200">
												{row.totalSkipped.toLocaleString()}
											</td>
											<td className="px-4 py-2.5 text-right tabular-nums text-stone-800 dark:text-stone-200">
												{row.totalFailed.toLocaleString()}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
