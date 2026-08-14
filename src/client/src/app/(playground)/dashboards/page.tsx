"use client";
import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import Explorer from "./explorer/page";

export default function DashboardPage() {
	const posthog = usePostHog();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.DASHBOARDS_PAGE_VISITED);
	}, []);

	return <Explorer />;
}
