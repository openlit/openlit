import getMessage from "@/constants/messages";

export type AlertSection = { id: string; href: string; label: string; match: (pathname: string) => boolean };

/**
 * Sections in the Alerts area. The enterprise overlay replaces this file to
 * add event history and notification destinations.
 */
export type NewAlertOption = { id: string; href: string; label: string };

/** Entries in the New alert button's menu. */
export function getNewAlertOptions(): NewAlertOption[] {
	return [{ id: "threshold", href: "/alerts/new", label: getMessage().ALERTING_NEW_THRESHOLD }];
}

export function getAlertSections(): AlertSection[] {
	const m = getMessage();
	return [
		{ id: "overview", href: "/alerts", label: m.ALERTING_OVERVIEW, match: (p) => p === "/alerts" },
		{
			id: "list",
			href: "/alerts/list",
			label: m.ALERTING_ALERTS,
			match: (p) => p.startsWith("/alerts/list") || p.startsWith("/alerts/new") || /^\/alerts\/(?!events|destinations)[^/]+/.test(p),
		},
	];
}
