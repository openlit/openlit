"use client";

import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import Link from "next/link";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { get } from "lodash";
import { format } from "date-fns";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import TableData from "@/components/common/table-data";
import { BookOpenText, TrashIcon } from "lucide-react";
import ConfirmationModal from "@/components/common/confirmation-modal";

const columns = [
	{
		key: "name",
		className: "col-span-2",
		header: "Name",
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
		render: (data: any, extraFunction: { handleDelete: (p?: any) => void }) => (
			<div className="flex justify-center gap-4">
				<Link
					href={`/prompt-hub/${data.promptId}`}
					className="inline-block hover:text-stone-700 hover:dark:text-stone-300"
				>
					<BookOpenText className="w-4 hover:text-primary" />
				</Link>
				<ConfirmationModal
					handleYes={extraFunction?.handleDelete}
					title="Are you sure you want to delete this prompt?"
					subtitle="Deleting prompts might result in breaking application if they are getting used. Please confirm before deleting it."
					params={{
						id: data.promptId,
					}}
				>
					<TrashIcon className="w-4 cursor-pointer hover:text-primary" />
				</ConfirmationModal>
			</div>
		),
	},
];

export default function PromptHub() {
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const { fireRequest: fireDeleteRequest, isLoading: isDeleting } =
		useFetchWrapper();
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

	const deletePrompt = useCallback(
		async ({ id }: { id: string }) => {
			fireDeleteRequest({
				requestType: "DELETE",
				url: `/api/prompt/${id}`,
				successCb: (data: any) => {
					toast.success(data, {
						id: "prompt-hub",
					});
					fetchData();
				},
				failureCb: (err?: string) => {
					toast.error(err || `Cannot connect to server!`, {
						id: "prompt-hub",
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

	const updatedData = (data as any) || [];

	return (
		<TableData
			columns={columns}
			data={updatedData}
			isFetched={isFetched || pingStatus === "failure"}
			isLoading={isLoading || isDeleting}
			idKey="promptId"
			extraFunction={{
				handleDelete: deletePrompt,
			}}
		/>
	);
}
