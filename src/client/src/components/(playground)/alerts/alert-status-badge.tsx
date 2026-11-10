"use client";

import getMessage from "@/constants/messages";
import { STATUS_CLASSES } from "./alert-format";

export function AlertStatusBadge({ status, firingCount }: { status: string; firingCount?: number }) {
	const m = getMessage();
	const label =
		status === "firing"
			? firingCount && firingCount > 1
				? m.ALERTING_STATUS_FIRING_N(firingCount)
				: m.ALERTING_STATUS_FIRING
			: status === "disabled"
				? m.ALERTING_STATUS_DISABLED
				: m.ALERTING_STATUS_OK;
	return (
		<span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASSES[status] || STATUS_CLASSES.ok}`}>
			{label}
		</span>
	);
}
