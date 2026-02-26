"use client";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import { TrashIcon } from "lucide-react";
import ConfirmationModal from "@/components/common/confirmation-modal";
import RuleEngineHeader from "@/components/(playground)/rule-engine/header";
import { Rule } from "@/types/rule-engine";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";

const columns: Columns<string, Rule> = {
	name: {
		header: () => "Name",
		cell: ({ row }) => (
			<span className="font-medium text-stone-800 dark:text-stone-200">
				{row.name}
			</span>
		),
	},
	description: {
		header: () => "Description",
		cell: ({ row }) => (
			<span className="text-stone-500 dark:text-stone-400 text-sm truncate block max-w-xs">
				{row.description || "-"}
			</span>
		),
	},
	groupOperator: {
		header: () => "Group Operator",
		cell: ({ row }) => (
			<Badge variant="outline"
				className="border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-400">
				{row.group_operator}
			</Badge>
		),
	},
	status: {
		header: () => "Status",
		cell: ({ row }) => (
			<Badge variant={row.status === "ACTIVE" ? "default" : "secondary"}>
				{row.status}
			</Badge>
		),
	},
	createdBy: {
		header: () => "Created By",
		cell: ({ row }) => (
			<span className="text-stone-600 dark:text-stone-400 text-sm">
				{row.created_by}
			</span>
		),
	},
	createdAt: {
		header: () => "Created At",
		cell: ({ row }) => (
			<span className="text-stone-500 dark:text-stone-400 text-sm">
				{row.created_at ? format(row.created_at, "MMM do, y") : "-"}
			</span>
		),
	},
	actions: {
		header: () => "Actions",
		cell: ({ row, extraFunctions }) => (
			<div
				className="flex justify-start items-center gap-4"
				onClick={(e) => e.stopPropagation()}
			>
				<ConfirmationModal
					handleYes={extraFunctions?.handleDelete}
					title="Are you sure you want to delete this rule?"
					subtitle="Deleting this rule will also remove all its conditions and entity associations."
					params={{ id: row.id }}
				>
					<TrashIcon className="w-4 cursor-pointer text-stone-400 hover:text-red-500 dark:text-stone-500 dark:hover:text-red-400 transition-colors" />
				</ConfirmationModal>
			</div>
		),
	},
};

export default function RuleEnginePage() {
	const { data, fireRequest, isFetched, isLoading } =
		useFetchWrapper<Rule[]>();
	const { fireRequest: fireDeleteRequest, isLoading: isDeleting } =
		useFetchWrapper();
	const pingStatus = useRootStore(getPingStatus);
	const router = useRouter();

	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "GET",
			url: `/api/rule-engine/rules`,
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "rule-engine",
				});
			},
		});
	}, []);

	const deleteRule = useCallback(
		async ({ id }: { id: string }) => {
			fireDeleteRequest({
				requestType: "DELETE",
				url: `/api/rule-engine/rules/${id}`,
				successCb: (data: any) => {
					toast.success(data, { id: "rule-engine" });
					fetchData();
				},
				failureCb: (err?: string) => {
					toast.error(err || `Cannot connect to server!`, {
						id: "rule-engine",
					});
				},
			});
		},
		[fetchData]
	);

	useEffect(() => {
		if (pingStatus !== "pending") {
			fetchData();
		}
	}, [pingStatus]);

	return (
		<div className="flex flex-col w-full h-full gap-4">
			<RuleEngineHeader successCallback={fetchData} />
			<DataTable
				columns={columns}
				data={data || []}
				isFetched={isFetched || pingStatus === "failure"}
				isLoading={isLoading || isDeleting}
				visibilityColumns={{
					name: true,
					description: true,
					groupOperator: true,
					status: true,
					createdBy: true,
					createdAt: true,
					actions: true,
				}}
				onClick={(row: Rule) => router.push(`/rule-engine/${row.id}`)}
				extraFunctions={{
					handleDelete: deleteRule,
					successCallback: fetchData,
				}}
			/>
		</div>
	);
}
