"use client";

import { formatBrowserDateTime, parseDateString } from "@/utils/date";
import getMessage from "@/constants/messages";
import type { UnifiedAgent } from "@/types/agents";

interface AgentMetadataGridProps {
	agent: UnifiedAgent;
}

function humanizeAge(firstSeenIso: string): string {
	if (!firstSeenIso) return "—";
	// `parseDateString` treats naked ClickHouse "YYYY-MM-DD HH:MM:SS" strings
	// as UTC (matching how `formatBrowserDateTime` displays them); raw
	// `new Date()` parses the same string as local time, which made AGE
	// disagree with FIRST SEEN by hours.
	const parsed = parseDateString(firstSeenIso);
	if (!parsed) return "—";
	const ms = Date.now() - parsed.getTime();
	if (!Number.isFinite(ms) || ms < 0) return "—";
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 365) return `${days}d`;
	const years = Math.floor(days / 365);
	const remDays = days % 365;
	return remDays > 0 ? `${years}y ${remDays}d` : `${years}y`;
}

export default function AgentMetadataGrid({ agent }: AgentMetadataGridProps) {
	return (
		<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
			<MetadataCard
				label={getMessage().AGENTS_METADATA_REQUESTS_24H}
				value={agent.request_count_24h.toLocaleString()}
			/>
			<MetadataCard
				label={getMessage().AGENTS_METADATA_PRIMARY_MODEL}
				value={agent.primary_model || "—"}
			/>
			<MetadataCard
				label={getMessage().AGENTS_METADATA_TOOLS}
				value={String(agent.tool_count)}
			/>
			<MetadataCard
				label={getMessage().AGENTS_METADATA_AGE}
				value={humanizeAge(agent.first_seen)}
			/>
			<MetadataCard
				label={getMessage().AGENTS_STAT_FIRST_SEEN}
				value={formatBrowserDateTime(agent.first_seen)}
			/>
			<MetadataCard
				label={getMessage().AGENTS_METADATA_LAST_SEEN}
				value={formatBrowserDateTime(agent.last_seen)}
			/>
		</div>
	);
}

function MetadataCard({
	label,
	value,
}: {
	label: string;
	value: React.ReactNode;
}) {
	return (
		<div className="border dark:border-stone-800 rounded-lg p-3">
			<div className="text-[10px] font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">
				{label}
			</div>
			<div className="mt-1 text-sm text-stone-900 dark:text-stone-100 break-words">
				{value}
			</div>
		</div>
	);
}
