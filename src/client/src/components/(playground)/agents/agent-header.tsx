"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";
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
	rightSlot?: React.ReactNode;
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

export default function AgentHeader({
	agent,
	onRefresh,
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

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-3">
				<Link
					href={backHref}
					className="flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
				>
					<ArrowLeft className="w-4 h-4" />
					{getMessage().AGENTS_BACK_TO_HUB}
				</Link>
				<button
					onClick={handleRefresh}
					disabled={isRefreshing}
					className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-50"
				>
					<RefreshCw
						className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`}
					/>
					{isRefreshing
						? getMessage().AGENTS_REFRESHING
						: getMessage().AGENTS_REFRESH}
				</button>
			</div>

			<div className="flex items-center justify-between gap-3 flex-wrap">
				{/* For coding-agent rows we render the vendor logo + the
				    pretty vendor label (e.g. "Claude Code" instead of
				    the raw `claude-code` service name). For services /
				    controllers we keep the existing service_name
				    rendering — no logo, no transformation. */}
				<h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100 inline-flex items-center gap-2">
					{hasCodingAgentVendorIcon(agent.coding_agent_vendor) ? (
						<>
							<CodingAgentVendorIcon
								vendor={agent.coding_agent_vendor}
								className="h-7 w-7 shrink-0"
							/>
							<span>
								{codingAgentVendorLabel(agent.coding_agent_vendor)}
							</span>
						</>
					) : (
						agent.service_name
					)}
				</h1>
				{rightSlot && <div className="shrink-0">{rightSlot}</div>}
			</div>
		</div>
	);
}
