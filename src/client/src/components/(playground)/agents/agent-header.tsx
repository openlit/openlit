"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Bot, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import getMessage from "@/constants/messages";
import type { UnifiedAgent } from "@/types/agents";
import {
	CodingAgentVendorIcon,
	codingAgentVendorLabel,
	hasCodingAgentVendorIcon,
} from "@/components/svg/coding-agents";

interface AgentHeaderProps {
	agent: UnifiedAgent;
	onRefresh: () => void;
	/** Pill tab switcher — same surface as the agents hub header actions. */
	tabs?: ReactNode;
	rightSlot?: ReactNode;
}

// Map a `?from=<tab>` source the table click stamped on the
// drill-in URL back into the agents-hub tab query the user expects
// to land on. We default to `services` (Applications) for
// unrecognised values so legacy links don't break, and to `coding`
// for coding-sourced agents — that way a deep link to a Claude
// Code session detail still routes back to the right tab even if
// `from` is missing.
function buildBackHref(
	from: string | null,
	agentSource: UnifiedAgent["source"] | undefined
) {
	const ALLOWED = new Set(["services", "controllers", "coding"]);
	let tab = from && ALLOWED.has(from) ? from : null;
	if (!tab) {
		tab = agentSource === "coding" ? "coding" : "services";
	}
	return tab === "services" ? "/agents" : `/agents?tab=${tab}`;
}

/** Soft sky chip — matches Telemetry Traces active tone, not solid teal. */
export const AGENTS_HEADER_TONE =
	"border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300";

/** Active pill tab — same soft sky treatment as Telemetry signal toggles. */
export const AGENTS_PILL_TAB_ACTIVE =
	"border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-400";

export default function AgentHeader({
	agent,
	onRefresh,
	tabs,
	rightSlot,
}: AgentHeaderProps) {
	const [isRefreshing, setIsRefreshing] = useState(false);
	const searchParams = useSearchParams();
	const backHref = useMemo(
		() => buildBackHref(searchParams?.get("from") || null, agent.source),
		[searchParams, agent.source]
	);

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		try {
			const res = await fetch(`/api/agents/${agent.agent_key}/refresh`, {
				method: "POST",
			});
			if (res.status === 429) {
				toast.message("Refresh cooling down — try again in a few seconds.");
			} else if (!res.ok) {
				toast.error(`Refresh failed: HTTP ${res.status}`);
			} else {
				onRefresh();
			}
		} catch (e) {
			toast.error(`Refresh failed: ${String(e)}`);
		} finally {
			setIsRefreshing(false);
		}
	}, [agent.agent_key, onRefresh]);

	const isCoding = agent.source === "coding";
	const title =
		isCoding && hasCodingAgentVendorIcon(agent.coding_agent_vendor)
			? codingAgentVendorLabel(agent.coding_agent_vendor)
			: agent.service_name;

	const icon =
		isCoding && hasCodingAgentVendorIcon(agent.coding_agent_vendor) ? (
			<CodingAgentVendorIcon
				vendor={agent.coding_agent_vendor}
				className="h-5 w-5"
			/>
		) : (
			<Bot className="h-5 w-5" />
		);

	const backLabel = getMessage().AGENTS_BACK_TO_HUB;

	return (
		<FeaturePageHeader
			eyebrow={getMessage().FEATURE_AGENTS}
			title={title}
			icon={icon}
			tone={AGENTS_HEADER_TONE}
			leading={
				<Button
					asChild
					variant="outline"
					size="sm"
					className="h-8 w-8 shrink-0 p-0"
				>
					<Link href={backHref} title={backLabel} aria-label={backLabel}>
						<ArrowLeft className="h-3.5 w-3.5" />
					</Link>
				</Button>
			}
			actions={
				<div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
					{tabs}
					{rightSlot}
					<button
						onClick={handleRefresh}
						disabled={isRefreshing}
						title={
							isRefreshing
								? getMessage().AGENTS_REFRESHING
								: getMessage().AGENTS_REFRESH
						}
						aria-label={
							isRefreshing
								? getMessage().AGENTS_REFRESHING
								: getMessage().AGENTS_REFRESH
						}
						className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-stone-600 transition hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 disabled:opacity-50"
					>
						<RefreshCw
							className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
						/>
					</button>
				</div>
			}
		/>
	);
}

/** Shared pill-tab button used by the agents hub and detail pages. */
export function AgentPillTab({
	active,
	label,
	onClick,
	indicator,
	indicatorTooltip,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
	indicator?: boolean;
	indicatorTooltip?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
				active
					? AGENTS_PILL_TAB_ACTIVE
					: "border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
			}`}
		>
			<span>{label}</span>
			{indicator ? (
				<span
					role="status"
					aria-label={indicatorTooltip}
					title={indicatorTooltip}
					className="inline-flex h-2 w-2 rounded-full bg-orange-500 motion-safe:animate-pulse"
				/>
			) : null}
		</button>
	);
}
