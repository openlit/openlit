"use client";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import { TrashIcon } from "lucide-react";
import ConfirmationModal from "@/components/common/confirmation-modal";
import ContextHeader from "@/components/(playground)/context/header";
import { Context } from "@/types/context";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import getMessage from "@/constants/messages";

const m = getMessage();

const columns: Columns<string, Context> = {
	name: {
		header: () => m.NAME,
		cell: ({ row }) => (
			<span className="font-medium text-stone-800 dark:text-stone-200">
				{row.name}
			</span>
		),
	},
	description: {
		header: () => m.DESCRIPTION,
		cell: ({ row }) => (
			<span className="text-stone-500 dark:text-stone-400 text-sm truncate block max-w-xs">
				{row.description || m.NO_DASH}
			</span>
		),
	},
	status: {
		header: () => m.STATUS,
		cell: ({ row }) => (
			<Badge variant={row.status === "ACTIVE" ? "default" : "secondary"}>
				{row.status}
			</Badge>
		),
	},
	createdBy: {
		header: () => m.CREATED_BY,
		cell: ({ row }) => (
			<span className="text-stone-600 dark:text-stone-400 text-sm">
				{row.created_by}
			</span>
		),
	},
	createdAt: {
		header: () => m.CREATED_AT,
		cell: ({ row }) => (
			<span className="text-stone-500 dark:text-stone-400 text-sm">
				{row.created_at ? format(row.created_at, "MMM do, y") : m.NO_DASH}
			</span>
		),
	},
	actions: {
		header: () => m.ACTIONS,
		cell: ({ row, extraFunctions }) => (
			<div
				className="flex justify-start items-center gap-4"
				onClick={(e) => e.stopPropagation()}
			>
				<ConfirmationModal
					handleYes={extraFunctions?.handleDelete}
					title={m.CONTEXT_DELETE_CONFIRM}
					subtitle={m.CONTEXT_DELETE_WARNING}
					params={{ id: row.id }}
				>
					<TrashIcon className="w-4 cursor-pointer text-stone-400 hover:text-red-500 dark:text-stone-500 dark:hover:text-red-400 transition-colors" />
				</ConfirmationModal>
			</div>
		),
	},
};

export default function ContextPage() {
	const { data, fireRequest, isFetched, isLoading } =
		useFetchWrapper<Context[]>();
	const { fireRequest: fireDeleteRequest, isLoading: isDeleting } =
		useFetchWrapper();
	const pingStatus = useRootStore(getPingStatus);
	const router = useRouter();

	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "GET",
			url: `/api/context`,
			failureCb: (err?: string) => {
				toast.error(err || m.CANNOT_CONNECT_TO_SERVER, {
					id: "context",
				});
			},
		});
	}, []);

	const deleteContext = useCallback(
		async ({ id }: { id: string }) => {
			fireDeleteRequest({
				requestType: "DELETE",
				url: `/api/context/${id}`,
				successCb: (data: any) => {
					toast.success(data, { id: "context" });
					fetchData();
				},
				failureCb: (err?: string) => {
					toast.error(err || m.CANNOT_CONNECT_TO_SERVER, {
						id: "context",
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
			<ContextHeader successCallback={fetchData} />
			<DataTable
				columns={columns}
				data={data || []}
				isFetched={isFetched || pingStatus === "failure"}
				isLoading={isLoading || isDeleting}
				visibilityColumns={{
					name: true,
					description: true,
					status: true,
					createdBy: true,
					createdAt: true,
					actions: true,
				}}
				onClick={(row: Context) => router.push(`/context/${row.id}`)}
				extraFunctions={{
					handleDelete: deleteContext,
					successCallback: fetchData,
				}}
			/>
		</div>
	);
}
