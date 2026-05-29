"use client";
import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import Filter from "@/components/(playground)/filter";
import {
	DashboardTypeFilter,
	DashboardTypeGraphContainer,
} from "./dashboard-type";

export default function DashboardPage() {
	const posthog = usePostHog();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.DASHBOARD_DETAIL_PAGE_VISITED);
	}, []);

	return (
		<>
			<div className="flex items-center w-full justify-between mb-4">
				<Filter />
				<DashboardTypeFilter />
			</div>
			<DashboardTypeGraphContainer />
		</>
	);
}
