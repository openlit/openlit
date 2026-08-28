"use client";

import { useCallback, useEffect } from "react";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { getPingStatus } from "@/selectors/database-config";
import { getCurrentProjectEnvironment } from "@/selectors/project";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";
import getMessage from "@/constants/messages";
import type { GenerationHealthChip } from "@/lib/platform/generation-health/classify";
import type { GenerationHealthRow } from "@/lib/platform/llm/generation-health";
import {
	fillTemplate,
	generationHealthChipLabel,
	generationHealthCountLine,
	generationHealthSkippedLine,
	generationHealthTipMeaning,
} from "@/lib/platform/generation-health/format";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

const METRICS: Array<{
	chip: GenerationHealthChip;
	countKey: keyof GenerationHealthRow;
	eligibleKey: keyof GenerationHealthRow;
}> = [
	{ chip: "truncated", countKey: "truncated", eligibleKey: "truncated_eligible" },
	{ chip: "filtered", countKey: "filtered", eligibleKey: "filtered_eligible" },
	{ chip: "empty", countKey: "empty", eligibleKey: "empty_eligible" },
	{ chip: "swapped", countKey: "swapped", eligibleKey: "swapped_eligible" },
];

export default function GenerationHealthBar() {
	const m = getMessage();
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const environment = useRootStore(getCurrentProjectEnvironment);
	const updateFilter = useRootStore(getUpdateFilter);
	const { data, isFetched, isLoading, fireRequest } = useFetchWrapper();
	const selected = filter.selectedConfig.generationHealth || [];

	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify({
				...getFilterParamsForDashboard(filter),
				...(environment ? { environment } : {}),
			}),
			requestType: "POST",
			url: "/api/telemetry/llm/generation-health",
			responseDataKey: "data[0]",
		});
	}, [environment, filter, fireRequest]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		) {
			fetchData();
		}
	}, [filter, fetchData, pingStatus]);

	const row = (data || {}) as GenerationHealthRow;
	if (row.unsupported) return null;

	const isLoadingData = isLoading || !isFetched || pingStatus === "pending";

	const toggle = (chip: GenerationHealthChip) => {
		const isOn = selected.length === 1 && selected[0] === chip;
		updateFilter("selectedConfig", {
			generationHealth: isOn ? [] : [chip],
		});
	};

	return (
		<div
			className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-stone-200 pt-2 dark:border-stone-800"
			aria-label={m.GENERATION_HEALTH_CHIP_GROUP}
		>
			<p className="text-[11px] font-medium text-stone-500 dark:text-stone-400">
				{m.GENERATION_HEALTH_CHIP_GROUP}
			</p>
			<TooltipProvider delayDuration={200}>
				<div className="flex min-w-0 flex-wrap items-center gap-1.5">
					{METRICS.map((metric) => {
						const count = Number(row[metric.countKey] || 0);
						const eligible = Number(row[metric.eligibleKey] || 0);
						const isActive = selected.includes(metric.chip);
						const ratio = fillTemplate(m.GENERATION_HEALTH_STAT_OF_ELIGIBLE, {
							count: isLoadingData ? "—" : count,
							eligible: isLoadingData ? "—" : eligible,
						});
						const hasHits = !isLoadingData && count > 0;
						const skippedLine = generationHealthSkippedLine(
							Math.max(row.llm_spans - eligible, 0),
							row.llm_spans
						);
						const label = generationHealthChipLabel(metric.chip);
						const meaning = generationHealthTipMeaning(metric.chip);
						const clickHint = isActive
							? m.GENERATION_HEALTH_CLICK_TO_CLEAR
							: m.GENERATION_HEALTH_CLICK_TO_FILTER;
						return (
							<Tooltip key={metric.chip}>
								<TooltipTrigger asChild>
									<button
										type="button"
										aria-pressed={isActive}
										aria-label={`${label}. ${meaning} ${ratio}. ${clickHint}`}
										onClick={() => toggle(metric.chip)}
										className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 ${
											isActive
												? "border-amber-700 bg-amber-700 text-white shadow-sm dark:border-amber-500 dark:bg-amber-600"
												: hasHits
													? "border-amber-300 bg-amber-50 font-medium text-amber-950 hover:border-amber-400 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-900/50"
													: "border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-950 dark:text-stone-200 dark:hover:border-stone-400"
										}`}
									>
										<span>{label}</span>
										<span className="font-medium">{ratio}</span>
									</button>
								</TooltipTrigger>
								<TooltipContent
									side="bottom"
									className="max-w-[260px] px-3 py-2 text-xs leading-relaxed"
								>
									{isLoadingData ? (
										m.LOADING
									) : (
										<div className="flex flex-col gap-1.5">
											<p className="font-medium text-stone-950 dark:text-stone-50">
												{meaning}
											</p>
											<p>
												{generationHealthCountLine(count, eligible)}
											</p>
											{skippedLine ? (
												<p className="text-stone-500 dark:text-stone-400">
													{skippedLine}
												</p>
											) : null}
											<p className="text-stone-500 dark:text-stone-400">
												{clickHint}
											</p>
										</div>
									)}
								</TooltipContent>
							</Tooltip>
						);
					})}
				</div>
			</TooltipProvider>
		</div>
	);
}
