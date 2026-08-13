"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

export default function NavigationEvents() {
	const posthog = usePostHog();
	const pathname = usePathname();
	// Track the last pathname we reported so query-string-only changes
	// (filters, tabs, refresh cursors) don't each fire a PAGE_VISITED.
	// Slimming to pathname-only keeps DAU/route analytics clean and cuts
	// free-tier event volume dramatically.
	const lastPathRef = useRef<string | null>(null);

	useEffect(() => {
		if (!pathname || lastPathRef.current === pathname) return;
		lastPathRef.current = pathname;
		posthog?.capture(CLIENT_EVENTS.PAGE_VISITED, {
			pathname,
		});
	}, [pathname, posthog]);

	return null;
}
