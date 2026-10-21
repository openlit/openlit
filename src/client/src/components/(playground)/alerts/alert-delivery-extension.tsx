"use client";

import { BellRing } from "lucide-react";
import getMessage from "@/constants/messages";

/** Opaque delivery settings the enterprise overlay stores with an alert. */
export type AlertDeliveryValue = Record<string, unknown>;

/**
 * Where an alert notifies. OpenLIT delivers in-app (the Alerts pages and the
 * header bell); the enterprise overlay replaces this with notification
 * connectors such as Slack, email, and webhooks.
 */
export default function AlertDeliveryExtension(_props: {
	alertId?: string;
	value: AlertDeliveryValue;
	onChange: (value: AlertDeliveryValue) => void;
}) {
	const m = getMessage();
	return (
		<div className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
			<BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" />
			<p>{m.ALERTING_DELIVERY_IN_APP}</p>
		</div>
	);
}
