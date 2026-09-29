"use client";

import { useCallback, useEffect } from "react";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { getPingStatus } from "@/selectors/database-config";
import { getCurrentProjectEnvironment } from "@/selectors/project";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";
import getMessage from "@/constants/messages";
import type { AgentLoopRow } from "@/lib/platform/llm/agent-loop";
import {
	asFiniteNumber,
	agentLoopCountLine,
	agentLoopTipMeaning,
	fillTemplate,
} from "@/lib/platform/agent-loop/format";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

export default function AgentLoopBar() {
	const m = getMessage();
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const environment = useRootStore(getCurrentProjectEnvironment);
	const updateFilter = useRootStore(getUpdateFilter);
	const { data, isFetched, isLoading, fireRequest, reset } = useFetchWrapper();
	const selected = Boolean(filter.selectedConfig.agentLoop);

	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify({
				...getFilterParamsForDashboard(filter),
				...(environment ? { environment } : {}),
			}),
			requestType: "POST",
			url: "/api/telemetry/llm/agent-loop",
			responseDataKey: "data[0]",
		});
	}, [environment, filter, fireRequest]);

	useEffect(() => {
		// Drop previous environment's counts — do not keep production chips
		// when the next environment's request fails or returns empty.
		reset();
	}, [environment, reset]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		) {
			fetchData();
		}
	}, [filter, fetchData, pingStatus, environment]);

	const row = (data || {}) as AgentLoopRow;
	if (row.unsupported) return null;

	const isLoadingData = isLoading || !isFetched || pingStatus === "pending";
	const count = asFiniteNumber(row.loops);
	const eligible = asFiniteNumber(row.tool_traces);
	const hasHits = !isLoadingData && count > 0;
	const ratio = fillTemplate(m.GENERATION_HEALTH_STAT_OF_ELIGIBLE, {
		count: isLoadingData ? "—" : count,
		eligible: isLoadingData ? "—" : eligible,
	});
	const meaning = agentLoopTipMeaning();
	const clickHint = selected
		? m.AGENT_LOOP_CLICK_TO_CLEAR
		: m.AGENT_LOOP_CLICK_TO_FILTER;

	const toggle = () => {
		updateFilter("selectedConfig", {
			agentLoop: selected ? false : true,
		});
	};

	return (
		<div
			className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5"
			aria-label={m.AGENT_LOOP_CHIP_GROUP}
		>
			<p className="text-[11px] font-medium text-stone-500 dark:text-stone-400">
				{m.AGENT_LOOP_CHIP_GROUP}
			</p>
			<TooltipProvider delayDuration={200}>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-pressed={selected}
							aria-label={`${m.AGENT_LOOP_CHIP}. ${meaning} ${ratio}. ${clickHint}`}
							onClick={toggle}
							className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 ${
								selected
									? "border-violet-700 bg-violet-700 text-white shadow-sm dark:border-violet-500 dark:bg-violet-600"
									: hasHits
										? "border-violet-300 bg-violet-50 font-medium text-violet-950 hover:border-violet-400 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-900/50"
										: "border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-950 dark:text-stone-200 dark:hover:border-stone-400"
							}`}
						>
							<span>{m.AGENT_LOOP_CHIP}</span>
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
								<p>{agentLoopCountLine(count, eligible)}</p>
								<p className="text-stone-500 dark:text-stone-400">
									{clickHint}
								</p>
							</div>
						)}
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</div>
	);
}
