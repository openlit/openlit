"use client";

import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import Link from "next/link";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Component, EyeIcon, PlayIcon } from "lucide-react";
import OpengroundHeader from "@/components/(playground)/openground/header";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import OpengroundGettingStarted from "@/components/(playground)/getting-started/openground";
import { OpengroundRecord } from "@/lib/platform/openground-clickhouse";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useRootStore } from "@/store";
import { useRouter } from "next/navigation";
import getMessage from "@/constants/messages";

function BestValue({ value, provider }: { value?: string; provider?: string }) {
	if (value === undefined || !provider) {
		return <span className="text-xs text-stone-500 dark:text-stone-400">—</span>;
	}
	return (
		<div className="flex min-w-0 flex-col">
			<span className="text-sm font-medium tabular-nums text-stone-900 dark:text-stone-100">
				{value}
			</span>
			<span className="truncate text-xs text-stone-500 dark:text-stone-400">
				{provider}
			</span>
		</div>
	);
}

const columns: Columns<string, OpengroundRecord> = {
	prompt: {
		header: () => getMessage().PROMPT,
		width: "minmax(14rem, 2.2fr)",
		cell: ({ row }) => (
			<p className="flex min-w-0 items-center gap-2 text-sm font-medium text-stone-900 dark:text-stone-100">
				{row.promptSource === "prompt-hub" && (
					<Component
						className="size-3.5 shrink-0 text-stone-500 dark:text-stone-400"
						aria-label={getMessage().PROMPT_HUB}
					/>
				)}
				<span className="truncate">{row.prompt}</span>
			</p>
		),
	},
	providers: {
		header: () => getMessage().PROVIDERS,
		width: "minmax(6rem, 0.7fr)",
		cell: ({ row }) => {
			const failed = row.errors?.length || 0;
			const succeeded = row.totalProviders - failed;
			return (
				<div className="flex items-center gap-1.5 tabular-nums">
					<span
						className="text-emerald-600 dark:text-emerald-400"
						title={getMessage().OPENGROUND_LIST_SUCCEEDED_PROVIDERS}
					>
						{succeeded}
					</span>
					<span className="h-3 w-px shrink-0 bg-stone-300 dark:bg-stone-700" />
					<span
						className={
							failed
								? "text-rose-600 dark:text-rose-400"
								: "text-stone-500 dark:text-stone-400"
						}
						title={getMessage().OPENGROUND_LIST_FAILED_PROVIDERS}
					>
						{failed}
					</span>
				</div>
			);
		},
	},
	bestCost: {
		header: () => getMessage().OPENGROUND_LIST_BEST_COST,
		cell: ({ row }) => (
			<BestValue
				value={row.minCostProvider !== undefined ? `$${row.minCost.toFixed(6)}` : undefined}
				provider={row.minCostProvider}
			/>
		),
	},
	bestSpeed: {
		header: () => getMessage().OPENGROUND_LIST_BEST_SPEED,
		cell: ({ row }) => (
			<BestValue
				value={
					row.minResponseTimeProvider !== undefined
						? `${row.minResponseTime.toFixed(2)}s`
						: undefined
				}
				provider={row.minResponseTimeProvider}
			/>
		),
	},
	bestEfficiency: {
		header: () => getMessage().BEST_EFFICIENCY,
		cell: ({ row }) => (
			<BestValue
				value={
					row.minCompletionTokensProvider !== undefined
						? `${row.minCompletionTokens} ${getMessage().OPENGROUND_LIST_TOKENS_SUFFIX}`
						: undefined
				}
				provider={row.minCompletionTokensProvider}
			/>
		),
	},
	createdAt: {
		header: () => getMessage().CREATED_AT,
		cell: ({ row }) => (
			<span className="text-sm text-stone-500 dark:text-stone-400">
				{format(new Date(row.createdAt), "MMM do, y HH:mm")}
			</span>
		),
	},
	actions: {
		header: () => getMessage().ACTIONS,
		width: "6rem",
		cell: ({ row, extraFunctions }) => (
			<div
				className="flex items-center gap-1"
				onClick={(e) => e.stopPropagation()}
			>
				<Button
					asChild
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-stone-500 dark:text-stone-400"
				>
					<Link
						href={`/openground/${row.id}`}
						title={getMessage().OPENGROUND_LIST_VIEW_RUN}
						aria-label={getMessage().OPENGROUND_LIST_VIEW_RUN}
					>
						<EyeIcon className="size-4" />
					</Link>
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 text-stone-500 dark:text-stone-400"
					title={getMessage().OPENGROUND_LIST_RERUN}
					aria-label={getMessage().OPENGROUND_LIST_RERUN}
					onClick={() => extraFunctions?.handleRerun(row)}
				>
					<PlayIcon className="size-4" />
				</Button>
			</div>
		),
	},
};

export default function Openground() {
	const posthog = usePostHog();
	const router = useRouter();
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper<OpengroundRecord[]>();
	const setPromptSource = useRootStore((state) => state.openground.setPromptSource);
	const reset = useRootStore((state) => state.openground.reset);

	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "GET",
			url: `/api/openground`,
			failureCb: (err?: string) => {
				toast.error(err || getMessage().CANNOT_CONNECT_TO_SERVER, {
					id: "openground",
				});
			},
		});
	}, []);

	const handleRerun = useCallback((record: OpengroundRecord) => {
		// Reset store and load the evaluation data
		reset();

		// Set prompt source
		setPromptSource({
			type: record.promptSource,
			content: record.prompt,
			promptId: record.promptHubId,
			version: record.promptHubVersion ? parseInt(record.promptHubVersion) : undefined,
			variables: record.promptVariables,
		});

		// Navigate to new evaluation page
		toast.success(getMessage().OPENGROUND_EVALUATION_LOADED, {
			id: "openground-rerun",
		});
		router.push("/openground/new");
	}, [reset, setPromptSource, router]);

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.OPENGROUND_PAGE_VISITED);
		fetchData();
	}, []);

	if (!data?.length && !isLoading && isFetched) {
		return (
			<div className="flex flex-col w-full h-full gap-4 overflow-auto">
				<OpengroundHeader validateResponse={false} />
				<div className="flex flex-col items-center mx-auto">
					<OpengroundGettingStarted />
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col w-full h-full">
			<OpengroundHeader validateResponse={false} />

			<div className="flex flex-col w-full h-full p-4 overflow-hidden">
				<DataTable
					columns={columns}
					data={data || []}
					isFetched={isFetched}
					isLoading={isLoading}
					visibilityColumns={{
						prompt: true,
						providers: true,
						bestCost: true,
						bestSpeed: true,
						bestEfficiency: true,
						createdAt: true,
						actions: true
					}}
					onClick={(row: OpengroundRecord) => router.push(`/openground/${row.id}`)}
					extraFunctions={{
						handleRerun,
					}}
				/>
			</div>
		</div>
	);
}
