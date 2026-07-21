"use client";

import { useCallback, useEffect } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";
import { getFilterDetails } from "@/selectors/filter";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import type { CostPricingGuidance } from "@/lib/platform/pricing/guidance";

export default function CostsAutoPricingBanner({
	onConfigure,
}: {
	onConfigure: () => void;
}) {
	const m = getMessage();
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } =
		useFetchWrapper<CostPricingGuidance>();

	const fetchData = useCallback(() => {
		fireRequest({
			body: JSON.stringify(getFilterParamsForDashboard(filter)),
			requestType: "POST",
			url: "/api/pricing/guidance",
			responseDataKey: "data",
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

	if (isLoading || !isFetched || pingStatus === "pending") {
		return null;
	}

	if (!data?.showBackfillBanner) {
		return null;
	}

	return (
		<div className="flex flex-col gap-3 rounded-md border border-emerald-200 bg-emerald-50/60 px-4 py-3 dark:border-emerald-900/70 dark:bg-emerald-950/30 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex items-start gap-3 min-w-0">
				<Info className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
				<div className="min-w-0">
					<p className="text-sm font-medium text-stone-900 dark:text-stone-100">
						{m.COSTS_BACKFILL_BANNER_TITLE}
					</p>
					<p className="mt-0.5 text-xs text-stone-600 dark:text-stone-400">
						{m.COSTS_BACKFILL_BANNER_DESCRIPTION}
					</p>
					<p className="mt-1 text-xs tabular-nums text-emerald-800 dark:text-emerald-200">
						{data.missingCostSpans.toLocaleString()}{" "}
						{m.COSTS_BACKFILL_BANNER_COUNT}
					</p>
				</div>
			</div>
			<Button
				size="sm"
				className="shrink-0"
				onClick={onConfigure}
			>
				{m.COSTS_BACKFILL_BANNER_CTA}
			</Button>
		</div>
	);
}
