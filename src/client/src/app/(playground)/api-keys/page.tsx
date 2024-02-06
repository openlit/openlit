"use client";
import AddAPIKeyModal from "@/components/(playground)/add-api-key-modal";
import ConfirmationModal from "@/components/common/confirmation-modal";
import { deleteData, getData } from "@/utils/api";
import { TrashIcon } from "@heroicons/react/24/outline";
import { PlusIcon } from "@heroicons/react/24/solid";
import { useCallback, useEffect, useState } from "react";

function ManageKeys() {
	const [data, setData] = useState<Array<any>>([]);
	const [selectedKey, setSelectedKey] = useState<any>();
	const [creating, setCreating] = useState<boolean>(false);
	const fetchData = useCallback(async () => {
		const res = await getData({
			method: "GET",
			url: "/api/api-key",
		});

		setData(res || []);
	}, []);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const handleYes = useCallback(async () => {
		await deleteData({
			url: `/api/api-key/${selectedKey?.id}`,
		});

		setSelectedKey(null);
		fetchData();
	}, [selectedKey, fetchData]);

	const handleNo = () => setSelectedKey(null);

	const handleYesCreation = async (name: string) => {
		await getData({
			url: `/api/api-key`,
			method: "POST",
			body: JSON.stringify({ name }),
		});

		setCreating(false);
		fetchData();
	};

	const handleNoCreation = () => setCreating(false);

	return (
		<>
			<table className="w-2/3 text-sm text-left rtl:text-right mt-4">
				<thead className="text-xs text-gray-700 uppercase">
					<tr className="border-b">
						<th className="px-6 py-2 w-1/3">Name</th>
						<th className="px-6 py-2 w-1/3">Key</th>
						<th className="px-6 py-2 w-1/3">Actions</th>
					</tr>
				</thead>
				<tbody>
					{data.map((item) => (
						<tr className="border-b" key={item.id}>
							<td className="px-6 py-3 w-1/3 font-medium ">{item.name}</td>
							<td className="px-6 py-3 w-1/3">{item.api_key}</td>
							<td className="px-6 py-3 w-1/3">
								<TrashIcon
									className="w-4 cursor-pointer"
									onClick={() => setSelectedKey(item)}
								/>
							</td>
						</tr>
					))}
					<tr onClick={() => setCreating(true)}>
						<td
							className="w-full bg-gray-200 hover:bg-gray-300 cursor-pointer py-1"
							colSpan={3}
						>
							<PlusIcon className="w-4 mx-auto" />
						</td>
					</tr>
				</tbody>
			</table>
			{selectedKey?.id && (
				<ConfirmationModal handleNo={handleNo} handleYes={handleYes} />
			)}
			{creating && (
				<AddAPIKeyModal
					handleNo={handleNoCreation}
					handleYes={handleYesCreation}
				/>
			)}
		</>
	);
}

export default function APIKeys() {
	return (
		<div className="flex flex-col grow w-full h-full rounded overflow-hidden p-2 text-sm">
			<p>
				Welcome to the API Key Management page. Here, you can view, generate,
				and manage API keys for seamless integration with our services.
			</p>
			<ul className="list-disc list-inside mt-2">
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
