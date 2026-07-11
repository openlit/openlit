import { get } from "lodash";
import { useCallback, useRef, useState } from "react";
import { deleteData, getData } from "@/utils/api";
import { FetchWrapperProps } from "@/types/fetch-wrapper";
import { peekTelemetryRequestCache } from "@/utils/telemetry-request-cache";

/**
 * Fetch hook with Grafana-style stale-while-revalidate semantics:
 *
 * - A monotonic `requestId` guard means only the newest in-flight request may
 *   write state, so a slow older response can never overwrite a newer one. We
 *   intentionally do NOT abort the underlying fetch: the telemetry request
 *   cache coalesces identical requests and shares a single promise, so
 *   aborting one consumer would reject that shared promise for everyone
 *   (this was the source of the "signal is aborted without reason" toast).
 * - On refetch (polling, filter re-stamps) we keep the previously loaded data
 *   visible and revalidate in the background instead of blanking the widget.
 * - The skeleton (`isLoading`) is only shown on the very first load or when a
 *   fresh cache seed is unavailable, so interval polling never empties the UI.
 */
export default function useFetchWrapper<T>() {
	const [data, setData] = useState<T | null>(null);
	const [isLoading, setIsLoading] = useState<boolean>(false);
	const [error, setError] = useState<unknown>(null);
	const [isFetched, setIsFetched] = useState<boolean>(false);
	const requestIdRef = useRef(0);
	const dataRef = useRef<T | null>(null);

	const applyData = useCallback((value: T | null) => {
		dataRef.current = value;
		setData(value);
	}, []);

	const fireRequest = useCallback(
		async ({
			body,
			failureCb,
			url,
			requestType,
			responseDataKey = "",
			successCb,
		}: FetchWrapperProps) => {
			const requestId = ++requestIdRef.current;
			const isCurrent = () => requestId === requestIdRef.current;

			let response;
			let error;

			// Stale-while-revalidate: seed synchronously from the short-lived
			// telemetry cache when possible; otherwise keep whatever we already
			// have and only show the skeleton on the very first load.
			const cached =
				requestType !== "DELETE"
					? peekTelemetryRequestCache<T>(url, body)
					: null;
			if (cached != null) {
				const seeded = get(cached, responseDataKey, cached) as T;
				applyData(seeded);
				setIsFetched(true);
				setIsLoading(false);
			} else if (dataRef.current == null) {
				setIsLoading(true);
			}
			setError(null);

			try {
				if (
					requestType === "GET" ||
					requestType === "POST" ||
					requestType === "PUT" ||
					requestType === "PATCH"
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

				// A newer request superseded us — let it own the state.
				if (!isCurrent()) return { response, error };

				if (response.err) {
					setError(response.err);
					// Preserve last-good data on transient errors so the page
					// doesn't blank; only clear when we have nothing to show.
					if (dataRef.current == null) applyData(null);
					if (typeof failureCb === "function") failureCb(response.err);
				} else {
					const finalResponse = get(response, responseDataKey, response);
					applyData(finalResponse);
					if (typeof successCb === "function") successCb(finalResponse);
				}
			} catch (errorResp) {
				if (!isCurrent()) return { response, error };
				if (typeof errorResp === "string") {
					error = errorResp;
				} else if (typeof errorResp === "object" && errorResp !== null) {
					error = (errorResp as any).message || (errorResp as any).error;
				}

				const updatedError = (error as any)?.toString().replaceAll("Error:", "");
				setError(updatedError);
				if (dataRef.current == null) applyData(null);
				if (typeof failureCb === "function") failureCb(updatedError);
			} finally {
				// Only the newest request settles the shared loading flags, so a
				// superseded/late response can never leave the UI stuck loading.
				if (isCurrent()) {
					setIsLoading(false);
					setIsFetched(true);
				}
			}

			return { response, error };
		},
		[applyData]
	);

	return { data, fireRequest, error, isFetched, isLoading };
}
