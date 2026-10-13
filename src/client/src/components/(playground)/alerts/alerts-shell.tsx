"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellRing } from "lucide-react";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import getMessage from "@/constants/messages";
import { getAlertSections } from "@/components/(playground)/alerts/alert-sections";

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

export function AlertsPageFrame({
	title,
	icon,
	leading,
	children,
}: {
	title?: string;
	icon?: ReactNode;
	leading?: ReactNode;
	children: ReactNode;
}) {
	const m = getMessage();
	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<FeaturePageHeader
				eyebrow={m.SIDEBAR_MONITOR}
				title={title || m.ALERTING_TITLE}
				icon={icon || <BellRing className="h-4 w-4" />}
				tone={ALERTS_HEADER_TONE}
				leading={leading}
				actions={<AlertsNavPills />}
			/>
			{children}
		</div>
	);
}
