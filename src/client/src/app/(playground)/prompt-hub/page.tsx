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
import { BookOpenText } from "lucide-react";

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
				<BookOpenText className="w-4"/>
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
		console.log(pingStatus);
		if (pingStatus !== "pending") fetchData();
	}, [pingStatus]);

	const updatedData = (data as any) || [];

	return (
		<TableData
			columns={columns}
			data={updatedData}
			isFetched={isFetched || pingStatus === "failure"}
			isLoading={isLoading}
			idKey="promptId"
		/>
	);
}
