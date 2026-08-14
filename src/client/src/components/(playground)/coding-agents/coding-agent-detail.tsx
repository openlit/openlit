"use client";

/**
 * Coding-agent detail view rendered when /agents/[agentKey] resolves to a
 * row with `source === "coding"`. The outer chrome (FeaturePageHeader +
 * pill tabs) lives on the parent detail page so it matches the agents
 * hub. This component only owns the tab panels:
 *
 *   - Overview   — embedded seeded dashboard for this vendor.
 *   - Sessions   — recent sessions with drill-in to per-session detail.
 *   - Users      — per-user rollups.
 */

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import getMessage from "@/constants/messages";
import type { UnifiedAgent } from "@/types/agents";

// The sessions list and embedded dashboard are heavier; lazy-load them
// so a user that just wants Overview doesn't pay for echarts + the
// session table on initial render.
const CodingSessionsTab = dynamic(
	() => import("./coding-sessions-tab"),
	{
		loading: () => <TabLoading label={getMessage().AGENTS_LOADING_REQUESTS} />,
		ssr: false,
	}
);
const CodingDashboardTab = dynamic(
	() => import("./coding-dashboard-tab"),
	{
		loading: () => <TabLoading label={getMessage().AGENTS_LOADING_DASHBOARD} />,
		ssr: false,
	}
);
const CodingUsersTab = dynamic(
	() => import("./coding-users-tab"),
	{
		loading: () => <TabLoading label={getMessage().AGENTS_LOADING_REQUESTS} />,
		ssr: false,
	}
);

interface CodingAgentDetailProps {
	agent: UnifiedAgent;
	tab: string;
	onTabChange: (tab: string) => void;
}

export default function CodingAgentDetail({
	agent,
	tab,
	onTabChange,
}: CodingAgentDetailProps) {
	// Pill tabs live in FeaturePageHeader on the parent page (same
	// surface as the agents hub). This component only owns the panels.
	return (
		<Tabs value={tab} onValueChange={onTabChange} className="w-full">
			<TabsContent value="overview" className="mt-0">
				<CodingDashboardTab agent={agent} />
			</TabsContent>

			<TabsContent value="sessions" className="mt-0">
				<CodingSessionsTab agent={agent} />
			</TabsContent>

			<TabsContent value="users" className="mt-0">
				<CodingUsersTab agent={agent} />
			</TabsContent>
		</Tabs>
	);
}

function TabLoading({ label }: { label: string }) {
	return (
		<div className="flex items-center justify-center py-12 text-sm text-stone-500 dark:text-stone-400 gap-2">
			<Loader2 className="w-4 h-4 animate-spin" />
			{label}
		</div>
	);
}
