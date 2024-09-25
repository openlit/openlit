"use client";

import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import Link from "next/link";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { EyeIcon } from "lucide-react";
import { get } from "lodash";
import { format } from "date-fns";
import IntermediateState from "@/components/(playground)/intermediate-state";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";

const columns = [
	{
		key: "promptName",
		className: "col-span-2",
		header: "Prompt Name",
	},
	{
		key: "createdBy",
		className: "col-span-2",
		header: "Created By",
	},
	{
		className: "col-span-2 text-center",
		header: "Latest Version",
		render: (data: any) => {
			const latestVersion = get(data, "latestVersion");
			return latestVersion || "draft";
		},
	},
	{
		header: "Downloads",
		className: "col-span-2 text-center",
		render: (data: any) => {
			const totalDownloads = get(data, "totalDownloads");
			const latestVersion = get(data, "latestVersion");
			return latestVersion ? totalDownloads : "-";
		},
	},
	{
		header: "Last Released On",
		className: "col-span-3",
		render: (data: any) => {
			const latestVersionDate = get(data, "latestVersionDate");
			const latestVersion = get(data, "latestVersion");
			return latestVersion ? format(latestVersionDate, "MMM do, y") : "-";
		},
	},
	{
		header: "Actions",
		className: "col-span-1 text-center",
		render: (data: any) => (
			<Link
				href={`/prompt-hub/${data.promptId}`}
				className="inline-block hover:text-stone-700 hover:dark:text-stone-300"
			>
				Edit
			</Link>
		),
	},
];

export default function PromptHub() {
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const pingStatus = useRootStore(getPingStatus);
	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "POST",
			url: `/api/prompt/get`,
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "prompt-hub",
				});
			},
		});
	}, []);

	useEffect(() => {
		if (pingStatus === "success") fetchData();
	}, [pingStatus]);

	const updatedData = (data as any) || [];

	return (
		<div className="flex flex-col w-full relative overflow-hidden rounded-md border dark:border-stone-500">
			<div className="grid grid-cols-12 border-b text-stone-500 text-sm bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-500">
				{columns.map((column, index) => {
					return (
						<div
							key={index}
							className={`items-center py-2 px-3 ${column.className}`}
						>
							{column.header}
						</div>
					);
				})}
			</div>
			<div
				className={`flex flex-col w-full text-sm text-left relative overflow-auto ${
					isFetched && isLoading ? "animate-pulse" : ""
				}`}
			>
				{(!isFetched || (isLoading && !updatedData?.length)) && (
					<div
						className={`flex items-center justify-center py-4 px-3`}
					>
						<div className="h-2 w-full bg-stone-100 dark:bg-stone-900 rounded col-span-1" />
					</div>
				)}
				{updatedData.map((item: any, index: number) => {
					return (
						<div
							className={`grid grid-cols-12 ${
								index === updatedData.length - 1
									? ""
									: "border-b dark:border-stone-500"
							} items-center cursor-pointer text-stone-600 dark:text-stone-300 group`}
							key={item.promptId}
						>
							{columns.map(({ key, render, className }, index) => (
								<div
									className={`${className} items-center py-2 px-3 text-ellipsis overflow-hidden`}
									key={`${item.promptId}-column-${index}`}
								>
									{render ? render(item) : get(item, key)}
								</div>
							))}
						</div>
					);
				})}
				{!updatedData?.length && !isLoading && isFetched && (
					<IntermediateState type="nodata" classNames="!p-3 text-xs" />
				)}
			</div>
		</div>
	);
}
