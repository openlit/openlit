"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import getMessage from "@/constants/messages";
import { getAlertSections } from "@/components/(playground)/alerts/alert-sections";
import NewAlertButton from "@/components/(playground)/alerts/new-alert-button";

export const ALERTS_HEADER_TONE =
	"border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300";

const PILL_ACTIVE =
	"border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300";
const PILL_IDLE =
	"border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800";

function AlertsNavPills() {
	const pathname = usePathname() || "/alerts";
	const sections = getAlertSections();
	const current = sections.find((section) => section.match(pathname))?.id || sections[0]?.id;
	return (
		<div className="flex flex-wrap items-center justify-end gap-2">
			{sections.map((section) => {
				const active = current === section.id;
				return (
					<Link
						key={section.id}
						href={section.href}
						aria-current={active ? "page" : undefined}
						className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${active ? PILL_ACTIVE : PILL_IDLE}`}
					>
						{section.label}
					</Link>
				);
			})}
		</div>
	);
}

/**
 * Page frame for every Alerts page. `backHref` adds the standard detail-page
 * back button; `newAlert` adds the New alert button after the section pills.
 */
export function AlertsPageFrame({
	title,
	icon,
	backHref,
	backLabel,
	newAlert = false,
	children,
}: {
	title?: string;
	icon?: ReactNode;
	backHref?: string;
	backLabel?: string;
	newAlert?: boolean;
	children: ReactNode;
}) {
	const m = getMessage();
	const label = backLabel || m.ALERTING_BACK;
	const leading = backHref ? (
		<Button asChild variant="outline" size="sm" className="h-7 w-7 shrink-0 p-0">
			<Link href={backHref} title={label} aria-label={label}>
				<ArrowLeft className="h-3.5 w-3.5" />
			</Link>
		</Button>
	) : undefined;
	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<FeaturePageHeader
				eyebrow={m.SIDEBAR_MONITOR}
				title={title || m.ALERTING_TITLE}
				icon={icon || <BellRing className="h-4 w-4" />}
				tone={ALERTS_HEADER_TONE}
				leading={leading}
				actions={
					<>
						<AlertsNavPills />
						{newAlert ? <NewAlertButton /> : null}
					</>
				}
			/>
			{children}
		</div>
	);
}
