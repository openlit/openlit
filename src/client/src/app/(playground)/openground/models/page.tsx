"use client";

import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { useRouter } from "next/navigation";

export default function OpengroundModelsPage() {
	const posthog = usePostHog();
	const router = useRouter();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.OPENGROUND_MODELS_PAGE_VISITED);
		router.replace("/settings/manage-models");
	}, []);

	return null;
}
