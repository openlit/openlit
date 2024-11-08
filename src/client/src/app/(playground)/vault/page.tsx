"use client";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { get } from "lodash";
import { format } from "date-fns";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import TableData from "@/components/common/table-data";
import { EditIcon, TrashIcon } from "lucide-react";
import ConfirmationModal from "@/components/common/confirmation-modal";
import VaultHeader from "@/components/(playground)/vault/header";
import { useParams } from "next/navigation";
import SecretForm from "@/components/(playground)/vault/form";

const columns = [
	{
		key: "key",
		className: "col-span-3",
		header: "Key",
	},
	{
		key: "created_by",
		className: "col-span-3",
		header: "Created By",
	},
	{
		header: "Last Updated On",
		className: "col-span-3",
		render: (data: any) => {
			const updatedAt = get(data, "updated_at");
			return updatedAt ? format(updatedAt, "MMM do, y") : "-";
		},
	},
	{
		header: "Actions",
		className: "col-span-3 text-center justify-center flex",
		render: (
			data: any,
			extraFunction: {
				handleDelete: (p?: any) => void;
				successCallback: () => void;
			}
		) => (
			<div className="flex justify-center gap-4">
				<SecretForm
					secretData={data}
					successCallback={extraFunction.successCallback}
				>
					<EditIcon className="w-4 cursor-pointer hover:text-primary" />
				</SecretForm>
				<ConfirmationModal
					handleYes={extraFunction?.handleDelete}
					title="Are you sure you want to delete this secret?"
					subtitle="Deleting secrets might result in breaking application if they are getting used. Please confirm before deleting it."
					params={{
						id: data.id,
					}}
				>
					<TrashIcon className="w-4 cursor-pointer hover:text-primary" />
				</ConfirmationModal>
			</div>
		),
	},
];

export default function Vault() {
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const params = useParams();
	const { fireRequest: fireDeleteRequest, isLoading: isDeleting } =
		useFetchWrapper();
	const pingStatus = useRootStore(getPingStatus);
	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "POST",
			url: `/api/vault/get`,
			body: JSON.stringify(""),
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "vault",
				});
			},
		});
	}, []);

	const deleteSecret = useCallback(
		async ({ id }: { id: string }) => {
			fireDeleteRequest({
				requestType: "DELETE",
				url: `/api/vault/${id}`,
				successCb: (data: any) => {
					toast.success(data, {
						id: "vault",
					});
					fetchData();
				},
				failureCb: (err?: string) => {
					toast.error(err || `Cannot connect to server!`, {
						id: "vault",
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
		<div className="flex flex-col w-full h-full gap-4">
			<VaultHeader createNew={!params.id} successCallback={fetchData} />
			<TableData
				columns={columns}
				data={updatedData}
				isFetched={isFetched || pingStatus === "failure"}
				isLoading={isLoading || isDeleting}
				idKey="id"
				extraFunction={{
					handleDelete: deleteSecret,
					successCallback: fetchData,
				}}
			/>
		</div>
	);
}
