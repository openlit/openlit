"use client";

import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import { SlidersHorizontal, TrashIcon } from "lucide-react";
import ConfirmationModal from "@/components/common/confirmation-modal";
import getMessage from "@/constants/messages";
import DataTable from "@/components/data-table/table";
import { Columns } from "@/components/data-table/columns";
import { PromptList } from "@/types/prompt";
import PromptsGettingStarted from "@/components/(playground)/getting-started/prompts";
import PromptHubHeader from "@/components/(playground)/prompt-hub/header";
import RuleForm from "@/components/(playground)/rule-engine/form";

const m = getMessage();

const columns: Columns<string, PromptList> = {
	name: {
		header: () => m.NAME,
		cell: ({ row }) => row.name,
	},
	createdBy: {
		header: () => m.CREATED_BY,
		cell: ({ row }) => row.createdBy,
	},
	latestVersion: {
		header: () => m.PROMPT_HUB_LATEST_VERSION,
		cell: ({ row }) => {
			const latestVersion = row.latestVersion;
			return latestVersion || m.PROMPT_HUB_DRAFT.toLowerCase();
		},
	},
	downloads: {
		header: () => m.PROMPT_HUB_DOWNLOADS,
		cell: ({ row }) => {
			const totalDownloads = row.totalDownloads;
			const latestVersion = row.latestVersion;
			return latestVersion ? totalDownloads : m.NO_DASH;
		},
	},
	lastReleasedOn: {
		header: () => m.PROMPT_HUB_LAST_RELEASED,
		cell: ({ row }) => {
			const latestVersionDate = row.latestVersionDate;
			const latestVersion = row.latestVersion;
			return latestVersion ? format(latestVersionDate, "MMM do, y") : m.NO_DASH;
		},
	},
	actions: {
		header: () => m.ACTIONS,
		cell: ({ row, extraFunctions }) => {
			return (
				<div
					className="flex justify-start items-center gap-4"
					onClick={(e) => e.stopPropagation()}
				>
					<RuleForm entityId={row.promptId} entityType="prompt">
						<SlidersHorizontal className="w-4 cursor-pointer text-stone-400 hover:text-primary transition-colors" />
					</RuleForm>
					<ConfirmationModal
						handleYes={extraFunctions?.handleDelete}
						title={m.PROMPT_HUB_DELETE_CONFIRM}
						subtitle={m.PROMPT_HUB_DELETE_WARNING}
						params={{
							id: row.promptId,
						}}
					>
						<TrashIcon className="w-4 cursor-pointer" />
					</ConfirmationModal>
				</div>
			);
		},
	},
};

export default function PromptHub() {
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper<PromptList[]>();
	const { fireRequest: fireDeleteRequest, isLoading: isDeleting } =
		useFetchWrapper();
	const pingStatus = useRootStore(getPingStatus);
	const router = useRouter();

	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "POST",
			url: `/api/prompt/get`,
			failureCb: (err?: string) => {
				toast.error(err || m.CANNOT_CONNECT_TO_SERVER, {
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
					toast.error(err || m.CANNOT_CONNECT_TO_SERVER, {
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

	if (!data?.length && !isLoading && isFetched) {
		return (
			<div className="flex flex-col items-center mx-auto p-8 overflow-auto">
				<PromptsGettingStarted />
			</div>
		);
	}

	return (
		<div className="flex flex-col w-full h-full gap-4">
			<PromptHubHeader createNew />
			<DataTable
				columns={columns}
				data={data || []}
				isFetched={isFetched || pingStatus === "failure"}
				isLoading={isLoading || isDeleting}
				visibilityColumns={{
					name: true,
					createdBy: true,
					latestVersion: true,
					downloads: true,
					lastReleasedOn: true,
					actions: true,
				}}
				onClick={(row: PromptList) => router.push(`/prompt-hub/${row.promptId}`)}
				extraFunctions={{
					handleDelete: deletePrompt,
				}}
			/>
		</div>
	);
}
