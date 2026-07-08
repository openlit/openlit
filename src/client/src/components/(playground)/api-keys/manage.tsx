"use client";
import ConfirmationModal from "@/components/common/confirmation-modal";
import { Badge } from "@/components/ui/badge";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import copy from "copy-to-clipboard";
import { format } from "date-fns";
import { CopyIcon, TrashIcon } from "lucide-react";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import Generate from "./generate";
import { ApiKey } from "@/types/api-key";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import { escapeEmailForDisplay } from "@/utils/string";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Key, Shield, RotateCcw, Trash2 } from "lucide-react";
import ApiKeysHeader from "./header-tabs";

const columns: Columns<string, ApiKey> = {
	name: {
		header: () => "Name",
		cell: ({ row }) => row.name,
	},
	apiKey: {
		header: () => "Api Key",
		cell: ({ row }) => {
			return (
				<Badge variant="outline" className="rounded-md">
					{row.apiKey?.replace(/(openlit-.{4}).*(.{6})$/, "$1...$2")}
				</Badge>
			);
		},
	},
	createdBy: {
		header: () => "Created By",
		cell: ({ row }) => {
			return escapeEmailForDisplay(row.createdByUser.email);
		},
	},
	createdAt: {
		header: () => "Created At",
		cell: ({ row }) => {
			return format(row.createdAt, "MMM do, y");
		},
	},
	actions: {
		header: () => "Actions",
		cell: ({ row, extraFunctions }) => {
			const copyAPIKey = () => {
				copy(row.apiKey);
				toast.success("Copied!", {
					id: "api-key",
				});
			};
			return (
				<div className="flex gap-4 justify-center">
					<ConfirmationModal
						handleYes={extraFunctions?.handleYes}
						title="Are you sure you want to delete?"
						subtitle="Deleting API keys might result in breaking application if they are getting used. Please confirm before deleting it."
						params={{
							id: row.id,
						}}
					>
						<TrashIcon className="w-4 cursor-pointer" />
					</ConfirmationModal>
					<CopyIcon
						className="w-4 cursor-pointer"
						onClick={copyAPIKey}
					/>
				</div>
			);
		},
	},
}

export default function ManageKeys() {
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper<ApiKey[]>();
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
		<div className="flex flex-col grow w-full overflow-hidden">
			<ApiKeysHeader actions={<Generate refresh={fetchData} />} />
			<div className="flex flex-col w-full h-full p-4 gap-4">
				<Alert className="border-amber-200 bg-amber-50/70 py-3 text-stone-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-stone-300">
					<Shield className="h-4 w-4 stroke-amber-700 dark:stroke-amber-300" />
					<AlertTitle className="text-sm font-semibold text-stone-900 dark:text-stone-100">
						Important notice
					</AlertTitle>
					<AlertDescription className="mt-1">
						<div className="grid gap-2 text-xs leading-relaxed text-stone-600 dark:text-stone-400 md:grid-cols-3">
							<div className="flex items-start gap-2">
								<Key className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>Secret keys are shown only once after generation.</span>
							</div>
							<div className="flex items-start gap-2">
								<RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>Rotate keys periodically and after team changes.</span>
							</div>
							<div className="flex items-start gap-2">
								<Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>Revoke unused or exposed keys immediately.</span>
							</div>
						</div>
					</AlertDescription>
				</Alert>
				<DataTable
					columns={columns}
					data={data || []}
					isFetched={isFetched || pingStatus !== "pending"}
					isLoading={isLoading || pingStatus === "pending"}
					visibilityColumns={{
						name: true,
						apiKey: true,
						createdBy: true,
						createdAt: true,
						actions: true,
					}}
					extraFunctions={{
						handleYes,
					}}
				/>
			</div>
		</div>
	);
}
