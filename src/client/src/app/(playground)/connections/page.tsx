"use client";
import ConfirmationModal from "@/components/common/confirmation-modal";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import {
	MouseEventHandler,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import toast from "react-hot-toast";
import { CONNECTIONS } from "./constant";
import { CheckBadgeIcon, TrashIcon } from "@heroicons/react/24/solid";
import AddConnections from "./add-connections";

const CONNECTIONS_TOAST_ID = "connection-details";

function ManageConnections() {
	const { data, fireRequest: fireGetRequest, isLoading } = useFetchWrapper();
	const { fireRequest: fireDeleteRequest, isLoading: isDeleting } =
		useFetchWrapper();
	const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
	const [askConfirmation, setAskConfirmation] = useState<boolean>(false);
	const [isDeletionConfirm, setIsDeletionConfirm] = useState<boolean>(false);

	const activeConnection = (data as any)?.[0] || {};

	const fetchData = useCallback(() => {
		fireGetRequest({
			url: "/api/connections",
			requestType: "GET",
		});
	}, []);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const handleDelete = useCallback(() => {
		toast.loading("Deleting Connection!", {
			id: CONNECTIONS_TOAST_ID,
		});
		fireDeleteRequest({
			url: `/api/connections/${activeConnection.id}`,
			requestType: "DELETE",
			successCb: () => {
				setIsDeletionConfirm(false);
				fetchData();
				toast.success("Connection deleted successfully!", {
					id: CONNECTIONS_TOAST_ID,
				});
			},
			failureCb: (err?: string) => {
				toast.error(err || "Connection deletion failed!", {
					id: CONNECTIONS_TOAST_ID,
				});
			},
		});
	}, [data]);

	const handleYes = () => {
		setAskConfirmation(false);
	};

	const handleNo = () => {
		setSelectedPlatform(null);
		setAskConfirmation(false);
		setIsDeletionConfirm(false);
	};

	const onClickPlatform: MouseEventHandler<HTMLDivElement> = (ev) => {
		const { platform } = (ev.currentTarget as HTMLDivElement).dataset;
		if (platform) {
			setSelectedPlatform(platform);
			activeConnection.id && setAskConfirmation(true);
		}
	};

	const onCloseSideover = () => {
		setSelectedPlatform(null);
	};

	const onSuccesscb = () => {
		fetchData();
		setSelectedPlatform(null);
	};

	const startDeletion: MouseEventHandler<SVGElement> = (ev) => {
		ev.stopPropagation();
		setIsDeletionConfirm(true);
	};

	return (
		<>
			<div className="flex flex-wrap gap-10 mt-4">
				{Object.keys(CONNECTIONS).map((connectionKey: string) => {
					const connection =
						CONNECTIONS[connectionKey as keyof typeof CONNECTIONS];
					const isActive = activeConnection.platform === connection.platform;
					return (
						<div
							key={connectionKey}
							className={`bg-secondary h-20 shadow hover:shadow-md flex card w-64 relative shrink-0 cursor-pointer ${
								isActive || !activeConnection.id
									? "rounded-b"
									: "rounded grayscale hover:grayscale-0"
							}`}
							data-platform={connection.platform}
							onClick={onClickPlatform}
						>
							<img
								className="w-1/2 h-full rounded-l-sm p-3"
								src={`/images/connections/${connection.image}`}
								alt="Room Image"
							/>
							<div className="w-full flex flex-col py-3">
								<h3
									className={`mb-1 font-medium flex-1 ${
										isActive ? "text-primary" : "text-tertiary"
									}`}
								>
									{connection.name}
								</h3>
								{isActive && (
									<TrashIcon
										className="absolute right-3 bottom-3 w-4 text-error"
										onClick={startDeletion}
									/>
								)}
							</div>
							{isActive && (
								<div className="bg-primary px-3 py-1 flex items-center justify-between transition text-xs shrink-0 absolute top-0 -translate-y-full w-full left-0 text-white rounded-t">
									Active
									<CheckBadgeIcon className="w-4" />
								</div>
							)}
						</div>
					);
				})}
			</div>
			{selectedPlatform && askConfirmation && (
				<ConfirmationModal
					title={
						"This will create a new connection and delete the old one. Are you sure you want to proceed with a new connection?"
					}
					handleNo={handleNo}
					handleYes={handleYes}
				/>
			)}
			{isDeletionConfirm && (
				<ConfirmationModal handleNo={handleNo} handleYes={handleDelete} />
			)}
			{selectedPlatform && !askConfirmation && (
				<AddConnections
					platform={selectedPlatform}
					onClose={onCloseSideover}
					onSuccesscb={onSuccesscb}
				/>
			)}
		</>
	);
}

export default function Connections() {
	return (
		<div className="flex flex-col w-full flex-1 overflow-auto">
			<h2 className="text-xl font-bold">
				Connect to your existing Observablity Platform
			</h2>
			<p className="text-base mb-5 text-tertiary/[0.8]">
				Doku improves observability by effortlessly exporting processed LLM data
				to your preferred observability platform. This enables developers to
				consolidate all application-related data, including LLM usage
				indicators, into a single platform, simplifying the visualisation and
				measurement of the entire application ecosystem.
			</p>
			<ManageConnections />
		</div>
	);
}
