"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CodingAgentVendor, UnifiedAgent } from "@/types/agents";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import { formatBrowserDateTime } from "@/utils/date";
import getMessage from "@/constants/messages";

interface CodingAgentsTableProps {
	services: UnifiedAgent[];
	isFetched: boolean;
	isLoading: boolean;
}

const VENDOR_LABELS: Record<CodingAgentVendor | string, string> = {
	"claude-code": "Claude Code",
	cursor: "Cursor",
	codex: "Codex",
	copilot: "Copilot CLI",
	windsurf: "Windsurf",
};

function vendorLabel(vendor: string | undefined): string {
	if (!vendor) return "Unknown";
	return VENDOR_LABELS[vendor] || vendor;
}

type CodingColumnKey =
	| "vendor"
	| "sessions"
	| "users"
	| "cost"
	| "lastSeen";

const columns: Columns<CodingColumnKey, UnifiedAgent> = {
	vendor: {
		header: () => getMessage().AGENTS_CODING_COLUMN_VENDOR,
		cell: ({ row }) => (
			<Link
				href={`/agents/${row.agent_key}`}
				className="font-medium text-stone-900 dark:text-stone-100 hover:underline truncate"
				onClick={(e) => e.stopPropagation()}
			>
				{vendorLabel(row.coding_agent_vendor)}
			</Link>
		),
		enableHiding: false,
	},
	sessions: {
		header: () => getMessage().AGENTS_CODING_COLUMN_SESSIONS,
		cell: ({ row }) => (
			<span className="text-sm text-stone-700 dark:text-stone-200 tabular-nums">
				{(row.coding_session_count_24h ?? 0).toLocaleString()}
			</span>
		),
	},
	users: {
		header: () => getMessage().AGENTS_CODING_COLUMN_USERS,
		cell: ({ row }) => (
			<span className="text-sm text-stone-700 dark:text-stone-200 tabular-nums">
				{(row.coding_active_users_24h ?? 0).toLocaleString()}
			</span>
		),
	},
	cost: {
		header: () => getMessage().AGENTS_CODING_COLUMN_COST,
		cell: ({ row }) => (
			<span className="text-sm text-stone-700 dark:text-stone-200 tabular-nums">
				${(row.coding_cost_usd_24h ?? 0).toFixed(2)}
			</span>
		),
	},
	lastSeen: {
		header: () => getMessage().AGENTS_COLUMN_LAST_SEEN,
		cell: ({ row }) => (
			<span className="text-xs truncate">
				{formatBrowserDateTime(row.last_seen)}
			</span>
		),
	},
};

const VISIBILITY_COLUMNS: Record<CodingColumnKey, boolean> = {
	vendor: true,
	sessions: true,
	users: true,
	cost: true,
	lastSeen: true,
};

export default function CodingAgentsTable({
	services,
	isFetched,
	isLoading,
}: CodingAgentsTableProps) {
	const router = useRouter();

	// Stable order: most-active first (sessions desc), then by last_seen.
	const sorted = useMemo(() => {
		return [...services].sort((a, b) => {
			const sa = a.coding_session_count_24h ?? 0;
			const sb = b.coding_session_count_24h ?? 0;
			if (sb !== sa) return sb - sa;
			return (b.last_seen || "").localeCompare(a.last_seen || "");
		});
	}, [services]);

	if (isFetched && !isLoading && sorted.length === 0) {
		return (
			<div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-700 px-6 py-10 text-center">
				<div className="text-sm font-medium text-stone-900 dark:text-stone-100">
					{getMessage().AGENTS_CODING_EMPTY_TITLE}
				</div>
				<div className="mt-1.5 text-xs text-stone-500 dark:text-stone-400 max-w-md mx-auto">
					{getMessage().AGENTS_CODING_EMPTY_BODY}
				</div>
			</div>
		);
	}

	return (
		<DataTable
			columns={columns}
			data={sorted}
			isFetched={isFetched}
			isLoading={isLoading}
			visibilityColumns={VISIBILITY_COLUMNS}
			extraFunctions={{}}
			onClick={(row) => router.push(`/agents/${row.agent_key}`)}
		/>
	);
}
