"use client";
import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import ManageKeys from "@/components/(playground)/api-keys/manage";

export default function APIKeys() {
	const posthog = usePostHog();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.SETTINGS_API_KEYS_PAGE_VISITED);
	}, []);

	return (
		<div className="flex w-full flex-1 overflow-hidden">
			<div className="flex flex-col grow w-full rounded overflow-auto text-stone-900 dark:text-stone-300 gap-4">
				<ManageKeys />
			</div>
		</div>
	);
}
