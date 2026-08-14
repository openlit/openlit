"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import type { UnifiedAgent } from "@/types/agents";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import {
	CodingAgentVendorIcon,
	codingAgentVendorLabel,
	hasCodingAgentVendorIcon,
} from "@/components/svg/coding-agents";
import getMessage from "@/constants/messages";

interface CodingAgentsTableProps {
	services: UnifiedAgent[];
	isFetched: boolean;
	isLoading: boolean;
}

type CodingColumnKey =
	| "vendor"
	| "sessions"
	| "users"
	| "cost"
	| "lines"
	| "acceptance"
	| "commits"
	| "prs";

// Compute acceptance % the same way listSessions / listCodingUsers do:
// the denominator is total edit decisions (accept + reject), not lines.
// Mirroring that keeps the hub stats consistent with the per-session
// list a click away.
function acceptancePct(row: UnifiedAgent): number {
	const accepts = row.coding_edit_accept_24h ?? 0;
	const rejects = row.coding_edit_reject_24h ?? 0;
	const total = accepts + rejects;
	if (!total) return 0;
	return Math.round((accepts * 100) / total);
}

const columns: Columns<CodingColumnKey, UnifiedAgent> = {
	vendor: {
		header: () => getMessage().AGENTS_CODING_COLUMN_VENDOR,
		cell: ({ row }) => {
			const vendor = row.coding_agent_vendor;
			const hasIcon = hasCodingAgentVendorIcon(vendor);
			return (
				<Link
					href={`/agents/${row.agent_key}?from=coding`}
					className="font-medium text-stone-900 dark:text-stone-100 hover:underline truncate flex items-center gap-2"
					onClick={(e) => e.stopPropagation()}
				>
					{hasIcon ? (
						<CodingAgentVendorIcon
							vendor={vendor}
							className="h-4 w-4 shrink-0"
						/>
					) : (
						<Bot className="h-4 w-4 shrink-0 text-stone-500" />
					)}
					<span className="truncate">{codingAgentVendorLabel(vendor)}</span>
				</Link>
			);
		},
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
	lines: {
		header: () => getMessage().AGENTS_CODING_COLUMN_LINES,
		cell: ({ row }) => (
			<span className="text-sm text-stone-700 dark:text-stone-200 tabular-nums">
				+{(row.coding_lines_added_24h ?? 0).toLocaleString()}
				<span className="ml-1 text-stone-400">/</span>
				<span className="ml-1 text-rose-600 dark:text-rose-400">
					-{(row.coding_lines_removed_24h ?? 0).toLocaleString()}
				</span>
			</span>
		),
	},
	acceptance: {
		header: () => getMessage().AGENTS_CODING_COLUMN_ACCEPTANCE,
		cell: ({ row }) => {
			const accepts = row.coding_edit_accept_24h ?? 0;
			const rejects = row.coding_edit_reject_24h ?? 0;
			const total = accepts + rejects;
			return (
				<span className="text-sm text-stone-700 dark:text-stone-200 tabular-nums">
					{total ? `${acceptancePct(row)}%` : "—"}
				</span>
			);
		},
	},
	commits: {
		header: () => getMessage().AGENTS_CODING_COLUMN_COMMITS,
		cell: ({ row }) => (
			<span className="text-sm text-stone-700 dark:text-stone-200 tabular-nums">
				{(row.coding_commit_count_24h ?? 0).toLocaleString()}
			</span>
		),
	},
	prs: {
		header: () => getMessage().AGENTS_CODING_COLUMN_PRS,
		cell: ({ row }) => (
			<span className="text-sm text-stone-700 dark:text-stone-200 tabular-nums">
				{(row.coding_pr_count_24h ?? 0).toLocaleString()}
			</span>
		),
	},
};

// Lines / Acceptance / Commits / PRs default ON. They're the new
// signal columns the user explicitly asked for; if an installation
// doesn't have data yet the cells render "0" / "—" which is the
// signal we want (zero is meaningful for "agents that haven't yet
// committed anything"). Users can hide them via the column toggle
// menu the DataTable already ships.
const VISIBILITY_COLUMNS: Record<CodingColumnKey, boolean> = {
	vendor: true,
	sessions: true,
	users: true,
	cost: true,
	lines: true,
	acceptance: true,
	commits: true,
	prs: true,
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
			onClick={(row) =>
				router.push(`/agents/${row.agent_key}?from=coding`)
			}
		/>
	);
}
