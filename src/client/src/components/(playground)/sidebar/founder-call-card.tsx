"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Phone, X } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import Otter from "@/components/svg/otter";
import { useEnterpriseFeatureAccess } from "@/components/enterprise-feature-access-provider";
import { useSidebarLayout } from "@/components/(playground)/sidebar-layout-context";
import getMessage from "@/constants/messages";
import { FOUNDER_SCHEDULE_URL } from "@/constants/external-links";
import { CLIENT_EVENTS } from "@/constants/events";

export const FOUNDER_CARD_DISMISSED_KEY = "openlit:founder-card-dismissed-at";
const DISMISS_DURATION_MS = 2 * 24 * 60 * 60 * 1000;

type AccessByAccountId = Record<string, Record<string, boolean | undefined> | undefined>;

// The access map only lists paid features, so any granted entry means a license is applied.
export function hasPaidFeatureAccess(
	accessByAccountId: AccessByAccountId,
	accountId: string
): boolean {
	return Object.values(accessByAccountId[accountId] ?? {}).some(Boolean);
}

function isDismissed(): boolean {
	const dismissedAt = Number(window.localStorage.getItem(FOUNDER_CARD_DISMISSED_KEY));
	return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_DURATION_MS;
}

export default function FounderCallCard() {
	const m = getMessage();
	const posthog = usePostHog();
	const { isExpanded } = useSidebarLayout();
	const { accessByAccountId, selectedAccountId } = useEnterpriseFeatureAccess();
	const [visible, setVisible] = useState(false);
	const licensed = hasPaidFeatureAccess(
		accessByAccountId as AccessByAccountId,
		selectedAccountId
	);

	useEffect(() => {
		setVisible(!isDismissed());
	}, []);

	if (!visible || licensed || !isExpanded) return null;

	const dismiss = () => {
		window.localStorage.setItem(FOUNDER_CARD_DISMISSED_KEY, String(Date.now()));
		setVisible(false);
	};

	return (
		<div className="relative mx-2 mb-2 shrink-0 overflow-hidden rounded-xl border border-stone-800 bg-stone-950 p-3 text-white shadow-lg shadow-primary/10">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(243,108,6,0.45),transparent_55%)]"
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(to_right,rgba(168,162,158,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(168,162,158,0.12)_1px,transparent_1px)] [background-size:16px_16px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
			/>
			<Otter className="pointer-events-none absolute -right-3 -top-2 size-16 rotate-12 text-primary/80" />
			<div className="relative">
				<div className="flex items-center gap-1.5">
					<span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
						<Phone className="size-3" />
						{m.FOUNDER_CARD_BADGE}
					</span>
				</div>
				<p className="mt-2.5 pr-10 text-sm font-semibold leading-5 tracking-tight">
					{m.FOUNDER_CARD_TITLE}
				</p>
				<p className="mt-1 text-xs leading-5 text-stone-400">
					{m.FOUNDER_CARD_BODY}
				</p>
				<div className="mt-3 flex items-center gap-1.5">
					<a
						href={FOUNDER_SCHEDULE_URL}
						target="_blank"
						rel="noopener noreferrer"
						onClick={() => posthog?.capture(CLIENT_EVENTS.FOUNDER_CALL_SCHEDULE_CLICKED)}
						className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md bg-primary text-xs font-semibold text-white transition-colors hover:bg-primary/90"
					>
						{m.FOUNDER_CARD_CTA}
						<ArrowUpRight className="size-3.5" />
					</a>
					<button
						type="button"
						onClick={dismiss}
						aria-label={m.FOUNDER_CARD_DISMISS}
						className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-stone-800 text-stone-400 transition-colors hover:bg-stone-800 hover:text-white"
					>
						<X className="size-3.5" />
					</button>
				</div>
			</div>
		</div>
	);
}
