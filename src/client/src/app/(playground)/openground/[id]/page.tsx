"use client";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import OpengroundHeader from "@/components/(playground)/openground/header";
import { OpengroundRecord } from "@/lib/platform/openground-clickhouse";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { format } from "date-fns";
import MetricsOverview from "@/components/(playground)/openground/metrics-overview";
import PerformanceWaterfall from "@/components/(playground)/openground/performance-waterfall";
import CostBreakdown from "@/components/(playground)/openground/cost-breakdown";
import ProviderResultCard from "@/components/(playground)/openground/provider-result-card";
import Link from "next/link";
import { ArrowLeft, Component } from "lucide-react";
import getMessage from "@/constants/messages";
import IntermediateState from "@/components/(playground)/intermediate-state";
import { Button } from "@/components/ui/button";

export default function OpengroundRequest({
	params,
}: {
	params: { id: string };
}) {
	const posthog = usePostHog();
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper<OpengroundRecord>();

	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "GET",
			url: `/api/openground/${params.id}`,
			failureCb: (err?: string) => {
				toast.error(err || getMessage().CANNOT_CONNECT_TO_SERVER, {
					id: "openground",
				});
			},
		});
	}, []);

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.OPENGROUND_DETAIL_PAGE_VISITED);
		fetchData();
	}, []);

	const m = getMessage();
	const backLabel = m.OPENGROUND_BACK_TO_LIST;

	const header = (
		<OpengroundHeader
			title={m.OPENGROUND_RUN_DETAILS}
			validateResponse={false}
			leading={
				<Button
					asChild
					variant="outline"
					size="sm"
					className="h-7 w-7 shrink-0 p-0"
				>
					<Link href="/openground" title={backLabel} aria-label={backLabel}>
						<ArrowLeft className="h-3.5 w-3.5" />
					</Link>
				</Button>
			}
		/>
	);

	if (isLoading || !isFetched)
		return (
			<div className="flex h-full w-full flex-col overflow-hidden">
				{header}
				<div className="flex flex-1 items-center justify-center">
					<IntermediateState type="loading" />
				</div>
			</div>
		);

	if (!data)
		return (
			<div className="flex h-full w-full flex-col overflow-hidden">
				{header}
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
					<p className="text-base font-medium text-stone-800 dark:text-stone-200">
						{m.OPENGROUND_RUN_NOT_FOUND}
					</p>
					<p className="max-w-md text-sm text-stone-500 dark:text-stone-400">
						{m.OPENGROUND_RUN_NOT_FOUND_DESCRIPTION}
					</p>
					<Button asChild variant="outline" size="sm" className="h-8">
						<Link href="/openground">{backLabel}</Link>
					</Button>
				</div>
			</div>
		);

	const errorCount = data.errors?.length || 0;
	const successCount = data.totalProviders - errorCount;
	const variableCount = data.promptVariables
		? Object.keys(data.promptVariables).length
		: 0;

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			{header}
			<div className="flex h-full w-full flex-col gap-4 overflow-auto p-4">
				{/* Run info */}
				<Card className="border border-stone-200 dark:border-stone-800">
					<CardContent className="p-0">
						<div className="p-4">
							<p className="mb-1 text-xs font-medium text-stone-500 dark:text-stone-400">
								{m.PROMPT}
							</p>
							<p className="whitespace-pre-wrap break-words text-sm text-stone-900 dark:text-stone-100">
								{data.prompt}
							</p>
						</div>
						<dl className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-stone-200 px-4 py-3 text-sm dark:border-stone-800">
							<div className="flex items-center gap-2">
								<dt className="text-xs font-medium text-stone-500 dark:text-stone-400">
									{m.PROVIDERS}
								</dt>
								<dd className="flex items-center gap-1.5 font-medium">
									<span
										className="text-emerald-600 dark:text-emerald-400"
										title={m.OPENGROUND_LIST_SUCCEEDED_PROVIDERS}
									>
										{successCount}
									</span>
									<span className="h-3 w-px shrink-0 bg-stone-300 dark:bg-stone-700" />
									<span
										className={
											errorCount > 0
												? "text-rose-600 dark:text-rose-400"
												: "text-stone-500 dark:text-stone-400"
										}
										title={m.OPENGROUND_LIST_FAILED_PROVIDERS}
									>
										{errorCount}
									</span>
								</dd>
							</div>
							<div className="flex items-center gap-2">
								<dt className="text-xs font-medium text-stone-500 dark:text-stone-400">
									{m.CREATED_AT}
								</dt>
								<dd className="text-stone-900 dark:text-stone-100">
									{format(new Date(data.createdAt), "MMM d, y HH:mm")}
								</dd>
							</div>
							{variableCount > 0 && (
								<div className="flex items-center gap-2">
									<dt className="text-xs font-medium text-stone-500 dark:text-stone-400">
										{m.VARIABLES}
									</dt>
									<dd className="text-stone-900 dark:text-stone-100">
										{variableCount}
									</dd>
								</div>
							)}
							{data.promptSource === "prompt-hub" && data.promptHubId ? (
								<div className="flex items-center gap-2">
									<dt className="text-xs font-medium text-stone-500 dark:text-stone-400">
										{m.PROMPT_HUB}
									</dt>
									<dd>
										<Link
											href={`/prompt-hub/${data.promptHubId}`}
											title={m.OPENGROUND_OPEN_IN_PROMPT_HUB}
											aria-label={m.OPENGROUND_OPEN_IN_PROMPT_HUB}
											className="text-stone-600 hover:text-primary dark:text-stone-300"
										>
											<Component className="h-4 w-4" />
										</Link>
									</dd>
								</div>
							) : null}
						</dl>
					</CardContent>
				</Card>

				{/* Provider Results */}
				{data.providers && data.providers.length > 0 && (
					<div className="flex flex-col gap-4">
						{/* Metrics Overview */}
						<MetricsOverview data={data.providers} />

						{/* Performance & Cost Analysis */}
						<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
							<PerformanceWaterfall data={data.providers} />
							<CostBreakdown data={data.providers} />
						</div>

						{/* Detailed Results */}
						<section className="flex flex-col gap-3">
							<h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">
								{data.providers.length === 1
									? m.OPENGROUND_PROVIDER_RESPONSE
									: m.OPENGROUND_PROVIDER_RESPONSES}
							</h2>
							{data.providers.map((result, index) => (
								<ProviderResultCard key={index} result={result} index={index} />
							))}
						</section>
					</div>
				)}
			</div>
		</div>
	);
}
