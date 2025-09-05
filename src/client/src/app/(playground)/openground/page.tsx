"use client";

import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import Link from "next/link";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { EyeIcon } from "lucide-react";
import OpengroundHeader from "@/components/(playground)/openground/header";
import { OpengroundRequest, OpengroundStats } from "@/types/openground";
import { Columns } from "@/components/data-table/columns";
import { jsonParse } from "@/utils/json";
import DataTable from "@/components/data-table/table";

const columns: Columns<string, OpengroundRequest> = {
	prompt: {
		header: () => "Prompt",
		cell: ({ row }) => {
			const stats: OpengroundStats = jsonParse(row.stats);
			return stats.prompt;
		},
	},
	createdBy: {
		header: () => "Created By",
		cell: ({ row }) => row.createdByUser.email,
	},
	databaseConfig: {
		header: () => "Database Config",
		cell: ({ row }) => {
			return row.databaseConfig.name;
		},
	},
	minCostProvider: {
		header: () => "Min Cost Provider",
		cell: ({ row }) => {
			const stats: OpengroundStats = jsonParse(row.stats);
			return stats.minCostProvider ? `${stats.minCostProvider} (${stats.minCost})` : "-";
		},
	},
	minResponseTime: {
		header: () => "Min Response Time",
		cell: ({ row }) => {
			const stats: OpengroundStats = jsonParse(row.stats);
			return stats.minResponseTimeProvider ? `${stats.minResponseTimeProvider} (${stats.minResponseTime})` : "-";
		},
	},
	minCompletionTokens: {
		header: () => "Min Completion Tokens",
		cell: ({ row }) => {
			const stats: OpengroundStats = jsonParse(row.stats);
			return stats.minCompletionTokensProvider ? `${stats.minCompletionTokensProvider} (${stats.minCompletionTokens})` : "-";
		},
	},
	actions: {
		header: () => "Actions",
		cell: ({ row }) => {
			return (
				<Link href={`/openground/${row.id}`}>
					<EyeIcon className="hover:text-stone-900 dark:hover:text-stone-800" />
				</Link>
			);
		},
	},
}

export default function Openground() {
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper<OpengroundRequest[]>();
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

	return (
		<div className="flex flex-col w-full h-full gap-4">
			<OpengroundHeader title="Openground Requests" validateResponse={false} />
			<DataTable
				columns={columns}
				data={data || []}
				isFetched={isFetched}
				isLoading={isLoading}
				visibilityColumns={{
					prompt: true,
					createdBy: true,
					databaseConfig: true,
					minCostProvider: true,
					minResponseTime: true,
					minCompletionTokens: true,
					actions: true
				}}
			/>
		</div>
	);
}
