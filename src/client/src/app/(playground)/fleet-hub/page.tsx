"use client";
import { useEffect } from "react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { Agent } from "@/types/fleet-hub";
import List from "./list";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

export default function Opamp() {
	const { fireRequest, data, isLoading, isFetched } = useFetchWrapper<Agent[]>();
	const posthog = usePostHog();

	useEffect(() => {
		fireRequest({
			requestType: "GET",
			url: `/api/fleet-hub`,
			responseDataKey: "data",
			successCb: (response) => {
				if (response?.data) {
					posthog?.capture(CLIENT_EVENTS.FLEET_HUB_VIEWED, {
						count: response?.data?.length || 0,
					});
				}
			},
		});
	}, []);

	return (
		<div className="flex flex-col w-full h-full">
			<List agents={data || []} isLoading={!data || isLoading} isFetched={isFetched} />
		</div>
	);
}
