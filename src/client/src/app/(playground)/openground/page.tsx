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
import OpengroundHeader from "@/components/(playground)/openground/header";

const columns = [
	{
		key: "stats.prompt",
		header: "Prompt",
	},
	{
		key: "createdByUser.email",
		header: "Created By",
	},
	{
		key: "databaseConfig.name",
		header: "Database config",
	},
	{
		header: "Min Cost",
		render: (data: any) => {
			const provider = get(data, "stats.minCostProvider");
			if (!provider) return "-";
			return (
				<p>
					{get(data, "stats.minCostProvider")} (${get(data, "stats.minCost")})
				</p>
			);
		},
	},
	{
		header: "Min Response Time",
		render: (data: any) => {
			const provider = get(data, "stats.minResponseTimeProvider");
			if (!provider) return "-";
			return (
				<p>
					{get(data, "stats.minResponseTimeProvider")} (
					{get(data, "stats.minResponseTime")}s)
				</p>
			);
		},
	},
	{
		header: "Min Completion Tokens",
		render: (data: any) => {
			const provider = get(data, "stats.minCompletionTokensProvider");
			if (!provider) return "-";
			return (
				<p>
					{get(data, "stats.minCompletionTokensProvider")} (
					{get(data, "stats.minCompletionTokens")})
				</p>
			);
		},
	},
	{
		header: "Actions",
		render: (data: any) => (
			<Link href={`/openground/${data.id}`}>
				<EyeIcon />
			</Link>
		),
	},
];

export default function Openground() {
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "GET",
			url: `/api/openground`,
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "openground",
				});
			},
		});
	}, []);

	useEffect(() => {
		fetchData();
	}, []);

	const updatedData = (data as any) || [];

	return (
		<div className="flex flex-col w-full h-full gap-4">
			<OpengroundHeader title="Openground Requests" validateResponse={false} />
			<div className="flex w-full overflow-auto relative">
				<Table>
					<TableHeader className="bg-stone-200 dark:bg-stone-800 sticky top-0 z-10">
						<TableRow>
							{columns.map((column, index) => {
								return (
									<TableHead
										key={index}
										className="text-stone-700 dark:text-stone-300"
									>
										{column.header}
									</TableHead>
								);
							})}
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading || !isFetched ? (
							<TableRow className="text-stone-600 dark:text-stone-400">
								<TableCell colSpan={columns.length} className="text-center">
									Loading
								</TableCell>
							</TableRow>
						) : updatedData.length === 0 ? (
							<TableRow className="text-stone-600 dark:text-stone-400">
								<TableCell colSpan={columns.length} className="text-center">
									No data to display
								</TableCell>
							</TableRow>
						) : (
							updatedData.map((item: any) => {
								const stats = JSON.parse(item.stats);
								const value = { ...item, stats };
								return (
									<TableRow
										key={item.id}
										className="text-stone-600 dark:text-stone-400 h-4"
									>
										{columns.map(({ key, render }, index) => (
											<TableCell key={`${value.id}-column-${index}`}>
												{render ? render(value) : get(value, key)}
											</TableCell>
										))}
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
