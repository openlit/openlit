"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

export default function EvaluationsPage() {
	const posthog = usePostHog();
	const router = useRouter();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.EVALUATIONS_PAGE_VISITED);
		router.replace("/evaluations/settings");
	}, []);

	return null;
}
