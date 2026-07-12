"use client";

/**
 * Dashboard tab for the coding-agent detail page.
 *
 * Embeds the seeded "Coding Agents" board inline (read-only) instead
 * of deep-linking out — same in-page rendering pattern that the LLM
 * Observability dashboard uses on the Applications detail page. We
 * resolve the seeded board by exact title (constant
 * `CODING_AGENTS_DASHBOARD_TITLE` mirrors the seed JSON's `title`
 * field). On rename, we'd rev that constant alongside the seed file.
 *
 * The Dashboard component already does width-aware layout, so we just
 * need to scope it to the coding-agent vendor by passing a `runFilters`
 * value through. The vendor scoping is enforced server-side because
 * the seed widgets all carry coding_agent.client filters in their
 * SQL templates.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, X } from "lucide-react";
import Dashboard from "@/components/(playground)/manage-dashboard/board-creator";
import {
	DashboardConfig,
	Widget,
} from "@/components/(playground)/manage-dashboard/board-creator/types";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";
import { useFilters } from "@/selectors/filter";
import getMessage from "@/constants/messages";
import type { UnifiedAgent } from "@/types/agents";

const CODING_AGENTS_DASHBOARD_TITLE = "Coding Agents";

interface CodingDashboardTabProps {
	agent: UnifiedAgent;
	/**
	 * Pre-applied user filter — set by the per-user page so the same
	 * board renders pinned to one developer. URL `?user=` still wins
	 * (set by Top-users widget click) so the filter cascades smoothly.
	 */
	pinnedUser?: string | null;
	/**
	 * Override vendor scoping. The per-vendor detail page pins to
	 * `agent.coding_agent_vendor` so the dashboard never aggregates
	 * across vendors (which would make the Total Cost widget here
	 * disagree with the agents-hub card and the Sessions/Users
	 * tabs). The per-user page leaves it `null` so the user's
	 * cross-vendor view stays intact.
	 */
	pinnedVendor?: string | null;
}

interface BoardSummary {
	id: string;
	title: string;
}

export default function CodingDashboardTab({
	agent,
	pinnedUser = null,
	pinnedVendor: pinnedVendorProp,
}: CodingDashboardTabProps) {
	// Default to the agent's vendor when no explicit override was
	// passed — the per-user page sends `pinnedVendor={null}` to opt
	// out, while the per-vendor detail page just inherits via the
	// agent prop.
	const pinnedVendor =
		pinnedVendorProp === null
			? null
			: pinnedVendorProp ?? agent.coding_agent_vendor ?? null;
	const { fireRequest } = useFetchWrapper();
	const { fireRequest: fireRunQuery } = useFetchWrapper();
	const { details: filter } = useFilters();
	const searchParams = useSearchParams();
	// URL `?user=` overrides the pinned prop so the Top-users widget
	// link can route the same board into a per-user view without a
	// page navigation. Falls back to the pinned prop (used by the
	// dedicated `/coding-agents/users/[userId]` page).
	const activeUser = searchParams?.get("user") || pinnedUser || null;
	const [config, setConfig] = useState<DashboardConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				setLoading(true);
				const { response: boardsRes } = await fireRequest({
					url: "/api/manage-dashboard/board",
					requestType: "GET",
				});
				if (cancelled) return;
				const boards = (boardsRes?.data || []) as BoardSummary[];
				const match =
					boards.find((b) => b.title === CODING_AGENTS_DASHBOARD_TITLE) ||
					null;
				if (!match) {
					setError("not_seeded");
					return;
				}
				const { response: layoutRes, error: layoutErr } = await fireRequest({
					url: `/api/manage-dashboard/board/${match.id}/layout`,
					requestType: "GET",
				});
				if (cancelled) return;
				if (layoutErr) {
					setError(String(layoutErr));
					return;
				}
				if (layoutRes?.data) {
					setConfig(layoutRes.data as DashboardConfig);
					setError(null);
				}
			} catch (e) {
				if (!cancelled) setError(String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [fireRequest]);

	const runFilters = useMemo(() => {
		const base = getFilterParamsForDashboard({ ...filter });
		// Inject the active-user filter as a top-level key on the
		// filter envelope so widget SQL templates can reference it via
		// `{{filter.user}}` (or pull it from the bag in custom
		// renderers). We keep it nullable rather than empty-string so
		// "no user filter" stays distinguishable from "explicitly empty
		// user".
		//
		// `filter.vendor` is the same shape: when set (per-vendor
		// detail page) the seed widgets gate their WHERE clauses on
		// `coding_agent.client = '{{filter.vendor}}'`. When unset
		// (per-user page) the widgets aggregate cross-vendor.
		const next: Record<string, unknown> = { ...base };
		if (pinnedVendor) {
			next.vendor = pinnedVendor;
		}
		if (activeUser) {
			next.user = activeUser;
			next.codingAgentUser = activeUser;
		}
		return next;
	}, [filter, activeUser, pinnedVendor]);

	const runQuery = async (
		widgetId: string,
		params: Record<string, unknown>
	) => {
		const data = await fireRunQuery({
			requestType: "POST",
			url: "/api/manage-dashboard/query/run",
			body: JSON.stringify({ widgetId, filter: runFilters, ...params }),
		});
		return data.response;
	};

	// We render the embedded dashboard read-only — editing the layout
	// belongs on /d/[id] where the full chrome (filters, share, edit
	// affordances) lives. Adopting the read-only mode also disables
	// drag/drop/resize so it never mutates the saved layout from a
	// per-vendor view.
	const handleSave = async () => {
		// no-op (readonly)
	};
	const handleWidgetCrud = async (_updates: Partial<Widget>) => {
		throw new Error("readonly_widget_edit_disabled");
	};
	const fetchExistingWidgets = async () => [] as Widget[];

	if (loading) {
		return (
			<div className="flex items-center justify-center py-12 text-sm text-stone-500 dark:text-stone-400 gap-2">
				<Loader2 className="w-4 h-4 animate-spin" />
				{getMessage().AGENTS_LOADING_DASHBOARD}
			</div>
		);
	}

	if (error === "not_seeded") {
		return (
			<div className="border dark:border-stone-800 rounded-lg p-6 text-sm text-stone-500 dark:text-stone-400">
				{getMessage().AGENTS_CODING_DASHBOARD_NOT_SEEDED}
			</div>
		);
	}

	if (error) {
		return (
			<div className="border border-red-200 dark:border-red-900/50 rounded-lg p-6 text-sm text-red-700 dark:text-red-400">
				{error}
			</div>
		);
	}

	if (!config) return null;

	const showUserPill =
		!!activeUser && searchParams?.get("user") === activeUser;

	return (
		<div className="space-y-3">
			{showUserPill ? (
				<div className="flex items-center gap-2">
					<Link
						href={typeof window !== "undefined" ? window.location.pathname : "."}
						className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/40"
						title="Clear user filter"
					>
						<span className="font-mono">@{activeUser}</span>
						<X className="h-3 w-3" />
					</Link>
				</div>
			) : null}
			<Dashboard
				className="overflow-visible"
				initialConfig={config}
				readonly
				runQuery={runQuery}
				onSave={handleSave}
				handleWidgetCrud={handleWidgetCrud}
				fetchExistingWidgets={fetchExistingWidgets}
				runFilters={runFilters}
			/>
		</div>
	);
}
