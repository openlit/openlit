import { get } from "lodash";
import { useCallback, useState } from "react";
import { deleteData, getData } from "@/utils/api";
import { FetchWrapperProps } from "@/types/fetch-wrapper";

export default function useFetchWrapper<T>() {
	const [data, setData] = useState<T | null>(null);
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
		}: FetchWrapperProps) => {
			setIsLoading(true);
			setError(null);
			try {
				let response;
				if (
					requestType === "GET" ||
					requestType === "POST" ||
					requestType === "PUT"
				) {
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

				if (response.err) {
					setData(null);
					setError(response.err);
					if (typeof failureCb === "function") failureCb(response.err);
				} else {
					const finalResponse = get(response, responseDataKey, response);
					setData(finalResponse);
					if (typeof successCb === "function") successCb(finalResponse);
				}
			} catch (error) {
				const updatedError = (error as any).toString().replaceAll("Error:", "");
				setError(updatedError);
				setData(null);
				if (typeof failureCb === "function") failureCb(updatedError);
			}

			setIsLoading(false);
			setIsFetched(true);
		},
		[setData, setError, setIsFetched, setIsLoading]
	);

	return { data, fireRequest, error, isFetched, isLoading };
}
