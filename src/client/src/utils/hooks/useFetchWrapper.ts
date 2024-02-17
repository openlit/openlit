import { get } from "lodash";
import { useCallback, useState } from "react";
import { deleteData, getData } from "@/utils/api";

type useFetchWrapperProps = {
	body?: string;
	failureCb?: () => void;
	url: string;
	requestType: "GET" | "POST" | "DELETE";
	responseDataKey?: string;
	successCb?: (res?: any) => void;
};

export default function useFetchWrapper() {
	const [data, setData] = useState<unknown>(null);
	const [isLoading, setIsLoading] = useState<boolean>(false);
	const [error, setError] = useState<unknown>(null);
	const [isFetched, setIsFetched] = useState<boolean>(false);

	const fireRequest = useCallback(
		async ({
			body,
			failureCb,
			url,
			requestType,
			responseDataKey = "",
			successCb,
		}: useFetchWrapperProps) => {
			setIsLoading(true);
			try {
				let response;
				if (requestType === "GET" || requestType === "POST") {
					response = await getData({
						body,
						url,
						method: requestType,
					});
				} else if (requestType === "DELETE") {
					response = await deleteData({
						url,
					});
				}

				const finalResponse = get(response, responseDataKey, response);
				setData(finalResponse);
				if (typeof successCb === "function") successCb(finalResponse); 
			} catch (error) {
				setError(error);
				if (typeof failureCb === "function") failureCb();
			}

			setIsLoading(false);
			setIsFetched(true);
		},
		[setData, setError, setIsFetched, setIsLoading]
	);

	return { data, fireRequest, error, isFetched, isLoading };
}
