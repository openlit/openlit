"use client";
import ConfirmationModal from "@/components/common/confirmation-modal";
import TableData from "@/components/common/table-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { noop } from "@/utils/noop";
import copy from "copy-to-clipboard";
import { format } from "date-fns";
import { get } from "lodash";
import { TrashIcon } from "lucide-react";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

const columns = [
	{
		className: "col-span-3",
		header: "Api key",
		render: (data: any) => {
			const apiKey = get(data, "apiKey");
			const copyAPIKey = () => {
				copy(apiKey);
				toast.success("Copied!", {
					id: "api-key",
				});
			};
			return (
				<Badge variant="outline" onClick={copyAPIKey} className="rounded-md">
					{apiKey.replace(/(openlit-.{6}).*(.{6})$/, "$1...$2")}
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
		className: "col-span-3",
		header: "Created At",
		render: (data: any) => {
			const createdAt = get(data, "createdAt");
			return format(createdAt, "MMM do, y");
		},
	},
	{
		header: "Actions",
		className: "col-span-3 text-center",
		render: (data: any, extraFunction?: any) => (
			<ConfirmationModal
				handleYes={extraFunction?.handleYes}
				title="Are you sure you want to delete?"
				subtitle="Deleting API keys might result in breaking application if they are getting used. Please confirm before deleting it."
				params={{
					id: data.id,
				}}
			>
				<TrashIcon className="w-4 cursor-pointer" />
			</ConfirmationModal>
		),
	},
];

function ManageKeys() {
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
		if (pingStatus !== "pending") fetchData();
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
		<div className="flex flex-col w-full gap-3">
			<GenerateNew refresh={fetchData} />
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

const GenerateNew = ({ refresh }: { refresh: () => void }) => {
	const { fireRequest: fireCreateRequest, isLoading: isCreating } =
		useFetchWrapper();
	const handleCreation = async () => {
		fireCreateRequest({
			requestType: "POST",
			url: `/api/api-key`,
			successCb: (data: any) => {
				copy(data.apiKey);
				toast.success("Generated and Copied new API key!", {
					id: "api-key",
				});
				refresh();
			},
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "api-key",
				});
			},
		});
	};

	return (
		<Button
			variant="secondary"
			className={`bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 py-2 h-auto py-2 rounded-sm self-end ${
				isCreating ? "animate" : ""
			}`}
			onClick={isCreating ? noop : handleCreation}
		>
			Generate New API Key
		</Button>
	);
};

export default function APIKeys() {
	return (
		<div className="flex flex-col grow w-full h-full rounded overflow-hidden p-2 text-sm text-stone-900 dark:text-stone-300 gap-3">
			<p>
				Welcome to the API Key Management page. Here, you can view, generate,
				and manage API keys for seamless integration with our services. Please
				note that we do not display your secret API keys again after you
				generate them.
			</p>
			<ul className="list-disc list-inside">
				<li>
					<span className="font-medium">Keep Your Keys Secure:</span> Treat your
					API keys like passwords. Do not share them publicly or expose them in
					places where unauthorized individuals may access them.
				</li>
				<li>
					<span className="font-medium">Rotate Keys Regularly:</span> For
					enhanced security, consider rotating your keys periodically.
				</li>
				<li>
					<span className="font-medium">Revoke Unused Keys:</span> If a key is
					no longer needed or compromised, revoke it immediately.
				</li>
			</ul>
			<ManageKeys />
		</div>
	);
}
