"use client";
import ConfirmationModal from "@/components/common/confirmation-modal";
import TableData from "@/components/common/table-data";
import { Badge } from "@/components/ui/badge";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import copy from "copy-to-clipboard";
import { format } from "date-fns";
import { get } from "lodash";
import { CopyIcon, TrashIcon } from "lucide-react";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import Generate from "./generate";

const columns = [
	{
		className: "col-span-3",
		header: "Name",
		key: "name",
	},
	{
		className: "col-span-2",
		header: "Api key",
		render: (data: any) => {
			const apiKey = get(data, "apiKey");
			return (
				<Badge variant="outline" className="rounded-md">
					{apiKey.replace(/(openlit-.{4}).*(.{6})$/, "$1...$2")}
				</Badge>
			);
		},
	},
	{
		key: "createdByUser.email",
		className: "col-span-3",
		header: "Created By",
	},
	{
		className: "col-span-2",
		header: "Created At",
		render: (data: any) => {
			const createdAt = get(data, "createdAt");
			return format(createdAt, "MMM do, y");
		},
	},
	{
		header: "Actions",
		className: "col-span-2 text-center",
		render: (data: any, extraFunction?: any) => {
			const apiKey = get(data, "apiKey");
			const copyAPIKey = () => {
				copy(apiKey);
				toast.success("Copied!", {
					id: "api-key",
				});
			};
			return (
				<div className="flex gap-4 justify-center">
					<ConfirmationModal
						handleYes={extraFunction?.handleYes}
						title="Are you sure you want to delete?"
						subtitle="Deleting API keys might result in breaking application if they are getting used. Please confirm before deleting it."
						params={{
							id: data.id,
						}}
					>
						<TrashIcon className="w-4 cursor-pointer hover:text-primary" />
					</ConfirmationModal>
					<CopyIcon
						className="w-4 cursor-pointer hover:text-primary"
						onClick={copyAPIKey}
					/>
				</div>
			);
		},
	},
];

export default function ManageKeys() {
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const { fireRequest: fireDeleteRequest } = useFetchWrapper();
	const pingStatus = useRootStore(getPingStatus);
	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "GET",
			url: `/api/api-key`,
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "api-key",
				});
			},
		});
	}, []);

	useEffect(() => {
		if (pingStatus !== "pending") {
			fetchData();
		}
	}, [pingStatus]);

	const handleYes = useCallback(
		async ({ id }: { id: string }) => {
			fireDeleteRequest({
				requestType: "DELETE",
				url: `/api/api-key/${id}`,
				successCb: () => {
					fetchData();
				},
				failureCb: (err?: string) => {
					toast.error(err || `Cannot connect to server!`, {
						id: "api-key",
					});
				},
			});
		},
		[fetchData]
	);

	return (
		<div className="flex flex-col grow w-full gap-3 overflow-hidden">
			<Generate refresh={fetchData} />
			<TableData
				columns={columns}
				data={(data || []) as any[]}
				isFetched={isFetched}
				isLoading={isLoading}
				extraFunction={{
					handleYes,
				}}
			/>
		</div>
	);
}
