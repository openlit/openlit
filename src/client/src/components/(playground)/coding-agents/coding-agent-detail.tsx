"use client";

/**
 * Coding-agent detail view rendered when /agents/[agentKey] resolves to a
 * row with `source === "coding"`. We keep the same outer chrome (header,
 * breadcrumbs) as the SDK/controller detail page but swap the body for a
 * tab set that's relevant to a fleet of coding-agent users:
 *
 *   - Overview   — rollups (sessions, cost, active users, top
 *                  models / tools / repos) over the time window
 *                  selected in the global filter picker — no fixed
 *                  24h fallback. The Overview tab body is the
 *                  embedded seeded dashboard; its widgets read
 *                  `{{filter.timeLimit.*}}` so they move with the
 *                  picker too.
 *   - Sessions   — recent sessions with drill-in to per-session detail.
 *   - Dashboard  — embedded seeded board for this vendor.
 *
 * Sessions and Dashboard are scaffolded here and wired up by the
 * queries-lib + api-routes + dashboard-seed todos. The Overview pulls
 * from the materialized rollups already on UnifiedAgent so it's live the
 * moment the materializer runs.
 */

import dynamic from "next/dynamic";
import {
	LayoutGrid,
	List,
	Loader2,
	Users,
} from "lucide-react";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
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
	// Overview is just the embedded "Coding Agents" board. The earlier
	// StatTile cluster + Client info card duplicated values that
	// already live on the board (cost, sessions, users) so we removed
	// them; the dashboard widgets + the page header carry that data.
	return (
		<Tabs value={tab} onValueChange={onTabChange} className="w-full">
			<TabsList className="h-auto rounded-none border-b border-stone-200 dark:border-stone-800 bg-transparent p-0 w-full justify-start gap-1">
				<UnderlineTab
					value="overview"
					icon={<LayoutGrid className="w-3.5 h-3.5" />}
					label={getMessage().AGENTS_TAB_OVERVIEW}
				/>
				<UnderlineTab
					value="sessions"
					icon={<List className="w-3.5 h-3.5" />}
					label={getMessage().AGENTS_CODING_TAB_SESSIONS}
				/>
				<UnderlineTab
					value="users"
					icon={<Users className="w-3.5 h-3.5" />}
					label={getMessage().AGENTS_CODING_USERS_SHORT_LABEL}
				/>
			</TabsList>

			<TabsContent value="overview" className="mt-4">
				<CodingDashboardTab agent={agent} />
			</TabsContent>

			<TabsContent value="sessions" className="mt-4">
				<CodingSessionsTab agent={agent} />
			</TabsContent>

			<TabsContent value="users" className="mt-4">
				<CodingUsersTab agent={agent} />
			</TabsContent>
		</Tabs>
	);
}

function UnderlineTab({
	value,
	icon,
	label,
}: {
	value: string;
	icon: React.ReactNode;
	label: string;
}) {
	return (
		<TabsTrigger
			value={value}
			className="rounded-none border-b-2 border-transparent bg-transparent shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-stone-900 dark:data-[state=active]:text-stone-100 data-[state=active]:shadow-none px-3 py-2 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 -mb-px flex items-center gap-1.5 relative"
		>
			{icon}
			{label}
		</TabsTrigger>
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
