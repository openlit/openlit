"use client";
import OpengroundHeader from "@/components/(playground)/openground/header";
import ProviderTable from "@/components/(playground)/openground/provider-table";
import { providersConfig } from "@/constants/openground";
import { Providers } from "@/types/store/openground";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import RequestInfo from "./request-info";

export default function OpengroundRequest({
	params,
}: {
	params: { id: string };
}) {
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "GET",
			url: `/api/openground/${params.id}`,
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "openground",
				});
			},
		});
	}, []);

	useEffect(() => {
		fetchData();
	}, []);

	if (isLoading || !isFetched)
		return (
			<div className="flex w-full h-full text-stone-600 dark:text-stone-400 items-center justify-center">
				Loading
			</div>
		);

	const [error, updatedData] = (data as any[]) || [];

	if (error || !updatedData)
		return (
			<div className="flex w-full h-full text-error items-center justify-center">
				{error || "No such request present"}
			</div>
		);

	const responseMeta = updatedData.responseMeta;
	const requestMeta = updatedData.requestMeta;

	return (
		<div className="flex flex-col w-full h-full gap-4">
			<OpengroundHeader
				title={`Request id : ${updatedData.id}`}
				validateResponse={false}
			/>
			<RequestInfo data={updatedData} />
			<div className="flex w-full h-full bg-stone-100 grow dark:bg-stone-900 overflow-auto transition-all relative gap-1">
				{requestMeta.selectedProviders?.map(
					({ provider }: { provider: Providers }, index: number) => (
						<ProviderTable
							key={`provider-${index}`}
							provider={providersConfig[provider]}
							index={index}
							selectedProviders={requestMeta.selectedProviders}
							evaluatedResponse={{
								isLoading: false,
								data: responseMeta,
							}}
						/>
					)
				)}
			</div>
		</div>
	);
}
