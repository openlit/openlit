"use client";
import AddAPIKeyModal from "@/components/(playground)/add-api-key-modal";
import ConfirmationModal from "@/components/common/confirmation-modal";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { Disclosure } from "@headlessui/react";
import { DocumentDuplicateIcon, TrashIcon } from "@heroicons/react/24/outline";
import copy from "copy-to-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

const API_KEY_TOAST_ID = "api-key-details";

function ManageKeys() {
	const { data, fireRequest: fireGetRequest, isLoading } = useFetchWrapper();
	const { fireRequest: fireDeleteRequest, isLoading: isDeleting } =
		useFetchWrapper();
	const { fireRequest: firePostRequest, isLoading: isCreating } =
		useFetchWrapper();
	const [selectedKey, setSelectedKey] = useState<any>();
	const [creating, setCreating] = useState<boolean>(false);
	const newCreatedKey = useRef<any>();
	const pingStatus = useRootStore(getPingStatus);

	const fetchData = useCallback(() => {
		fireGetRequest({
			url: "/api/api-key",
			requestType: "GET",
		});
	}, []);

	useEffect(() => {
		if (pingStatus === "success") fetchData();
	}, [fetchData, pingStatus]);

	const handleYes = useCallback(() => {
		toast.loading("Deleting API key!", {
			id: API_KEY_TOAST_ID,
		});
		fireDeleteRequest({
			url: `/api/api-key/${selectedKey?.id}`,
			requestType: "DELETE",
			successCb: () => {
				setSelectedKey(null);
				fetchData();
				toast.success("API key deleted successfully!", {
					id: API_KEY_TOAST_ID,
				});
			},
			failureCb: (err?: string) => {
				toast.error(err || "API key deletion failed!", {
					id: API_KEY_TOAST_ID,
				});
			},
		});
	}, [selectedKey?.id]);

	const handleNo = () => setSelectedKey(null);

	const handleYesCreation = useCallback(async (name: string) => {
		toast.loading("Creating an API key!", {
			id: API_KEY_TOAST_ID,
		});
		firePostRequest({
			url: `/api/api-key`,
			requestType: "POST",
			body: JSON.stringify({ name }),
			successCb: (data = []) => {
				newCreatedKey.current = data[0] || {};
				setCreating(false);
				fetchData();
				toast.success("API key created successfully!", {
					id: API_KEY_TOAST_ID,
				});
			},
			failureCb: (err?: string) => {
				toast.error(err?.toString() || "API key creation failed!", {
					id: API_KEY_TOAST_ID,
				});
			},
		});
	}, []);

	const handleNoCreation = () => setCreating(false);

	const copyAPIKey = () => copy(newCreatedKey.current?.api_key);

	return (
		<>
			<table className="w-2/3 text-sm text-left rtl:text-right mt-4">
				<thead className="text-xs text-tertiary uppercase">
					<tr className="border-b border-secondary">
						<th className="px-6 py-2 w-1/3">Name</th>
						<th className="px-6 py-2 w-1/3">Key</th>
						<th className="px-6 py-2 w-1/3">Actions</th>
					</tr>
				</thead>
				<tbody>
					{(data as Array<any>)?.map((item) => (
						<tr className="border-b border-secondary" key={item.id}>
							<td className="px-6 py-3 w-1/3 font-medium ">{item.name}</td>
							<td className="px-6 py-3 w-1/3">
								{item.api_key}
								{newCreatedKey.current?.id === item.id && (
									<DocumentDuplicateIcon
										className="w-4 ml-1 inline cursor-pointer"
										onClick={copyAPIKey}
									/>
								)}
							</td>
							<td className="px-6 py-3 w-1/3">
								<TrashIcon
									className="w-4 cursor-pointer"
									onClick={() => setSelectedKey(item)}
								/>
							</td>
						</tr>
					))}
					{isLoading || pingStatus === "pending" && (
						<tr className="border-b border-secondary animate-pulse">
							<td className="px-6 py-3 w-1/3 font-medium ">
								<div className="h-2 w-2/3 bg-secondary/[0.9] rounded"></div>
							</td>
							<td className="px-6 py-3 w-1/3">
								<div className="h-2 w-2/3 bg-secondary/[0.9] rounded"></div>
							</td>
							<td className="px-6 py-3 w-1/3">
								<div className="h-2 w-1/3 bg-secondary/[0.9] rounded"></div>
							</td>
						</tr>
					)}
				</tbody>
			</table>
			<button
				type="button"
				className="bg-primary/[0.8] text-secondary hover:bg-primary cursor-pointer px-3 py-0.5 text-center text-sm self-start rounded mt-3 outline-none"
				onClick={() => setCreating(true)}
			>
				Add new
			</button>
			{selectedKey?.id && (
				<ConfirmationModal
					handleNo={handleNo}
					handleYes={handleYes}
					isUpdating={isDeleting}
				/>
			)}
			{creating && (
				<AddAPIKeyModal
					handleNo={handleNoCreation}
					handleYes={handleYesCreation}
					isCreating={isCreating}
				/>
			)}
		</>
	);
}

export default function APIKeys() {
	return (
		<div className="flex flex-col w-full flex-1 overflow-auto">
			<p className="text-base mb-5 text-tertiary/[0.8]">
				Welcome to the API Key Management page. Here, you can view, generate,
				and manage API keys for seamless integration with our services. Please
				note that we do not display your secret API keys again after you
				generate them.
			</p>
			<Disclosure defaultOpen>
				<Disclosure.Button className="flex w-full justify-between rounded-t-lg bg-secondary px-4 py-2 text-left text-sm font-medium text-primary focus:outline-none">
					Keep Your Keys Secure
				</Disclosure.Button>
				<Disclosure.Panel className="p-4 text-sm rounded-b-lg text-tertiary/[0.7] bg-secondary/[0.5]">
					Treat your API keys like passwords. Do not share them publicly or
					expose them in places where unauthorized individuals may access them.
				</Disclosure.Panel>
			</Disclosure>
			<Disclosure defaultOpen>
				<Disclosure.Button className="flex w-full justify-between rounded-t-lg bg-secondary px-4 py-2 text-left text-sm font-medium text-primary focus:outline-none mt-3">
					Rotate Keys Regularly
				</Disclosure.Button>
				<Disclosure.Panel className="p-4 text-sm rounded-b-lg text-tertiary/[0.7] bg-secondary/[0.5]">
					For enhanced security, consider rotating your keys periodically.
				</Disclosure.Panel>
			</Disclosure>
			<Disclosure defaultOpen>
				<Disclosure.Button className="flex w-full justify-between rounded-t-lg bg-secondary px-4 py-2 text-left text-sm font-medium text-primary focus:outline-none mt-3">
					Revoke Unused Keys
				</Disclosure.Button>
				<Disclosure.Panel className="p-4 text-sm rounded-b-lg text-tertiary/[0.7] bg-secondary/[0.5]">
					If a key is no longer needed or compromised, revoke it immediately.
				</Disclosure.Panel>
			</Disclosure>
			<ManageKeys />
		</div>
	);
}
