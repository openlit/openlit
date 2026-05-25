"use client";

/**
 * Coding-agent detail view rendered when /agents/[agentKey] resolves to a
 * row with `source === "coding"`. We keep the same outer chrome (header,
 * breadcrumbs) as the SDK/controller detail page but swap the body for a
 * tab set that's relevant to a fleet of coding-agent users:
 *
 *   - Overview   — last-24h rollups (sessions, cost, active users, top
 *                  models / tools / repos).
 *   - Sessions   — recent sessions with drill-in to per-session detail.
 *   - Dashboard  — embedded seeded board for this vendor.
 *
 * Sessions and Dashboard are scaffolded here and wired up by the
 * queries-lib + api-routes + dashboard-seed todos. The Overview pulls
 * from the materialized rollups already on UnifiedAgent so it's live the
 * moment the materializer runs.
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import {
	BarChart3,
	Bot,
	Cpu,
	DollarSign,
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
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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

const VENDOR_LABELS: Record<string, string> = {
	"claude-code": "Claude Code",
	cursor: "Cursor",
	codex: "Codex",
	copilot: "GitHub Copilot CLI",
	windsurf: "Windsurf",
};

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
	const vendorLabel = useMemo(
		() =>
			VENDOR_LABELS[agent.coding_agent_vendor || ""] ||
			agent.service_name ||
			"Coding agent",
		[agent.coding_agent_vendor, agent.service_name]
	);

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
					value="dashboard"
					icon={<BarChart3 className="w-3.5 h-3.5" />}
					label={getMessage().AGENTS_TAB_DASHBOARD}
				/>
			</TabsList>

			<TabsContent value="overview" className="mt-4">
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
					<StatTile
						icon={<Bot className="w-4 h-4" />}
						label={getMessage().AGENTS_CODING_OVERVIEW_VENDOR_LABEL}
						value={vendorLabel}
					/>
					<StatTile
						icon={<List className="w-4 h-4" />}
						label={getMessage().AGENTS_CODING_OVERVIEW_SESSIONS_LABEL}
						value={(agent.coding_session_count_24h ?? 0).toLocaleString()}
					/>
					<StatTile
						icon={<Users className="w-4 h-4" />}
						label={getMessage().AGENTS_CODING_OVERVIEW_USERS_LABEL}
						value={(agent.coding_active_users_24h ?? 0).toLocaleString()}
					/>
					<StatTile
						icon={<DollarSign className="w-4 h-4" />}
						label={getMessage().AGENTS_CODING_OVERVIEW_COST_LABEL}
						value={`$${(agent.coding_cost_usd_24h ?? 0).toFixed(2)}`}
					/>
				</div>

				<Card className="mt-4">
					<CardHeader>
						<CardTitle className="text-sm font-medium flex items-center gap-2">
							<Cpu className="w-4 h-4" />
							{getMessage().AGENTS_CODING_OVERVIEW_CLIENT_LABEL}
						</CardTitle>
					</CardHeader>
					<CardContent className="text-sm text-stone-600 dark:text-stone-400">
						<dl className="grid grid-cols-2 gap-y-2">
							<dt className="text-stone-500">Vendor</dt>
							<dd>{agent.coding_agent_vendor || "—"}</dd>
							<dt className="text-stone-500">Latest CLI version</dt>
							<dd>{agent.sdk_version || "—"}</dd>
							<dt className="text-stone-500">First seen</dt>
							<dd>{formatDate(agent.first_seen)}</dd>
							<dt className="text-stone-500">Last seen</dt>
							<dd>{formatDate(agent.last_seen)}</dd>
						</dl>
					</CardContent>
				</Card>
			</TabsContent>

			<TabsContent value="sessions" className="mt-4">
				<CodingSessionsTab agent={agent} />
			</TabsContent>

			<TabsContent value="dashboard" className="mt-4">
				<CodingDashboardTab agent={agent} />
			</TabsContent>
		</Tabs>
	);
}

function StatTile({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
}) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between pb-2">
				<CardTitle className="text-xs font-medium text-stone-500 dark:text-stone-400">
					{label}
				</CardTitle>
				<span className="text-stone-400">{icon}</span>
			</CardHeader>
			<CardContent>
				<div className="text-xl font-semibold text-stone-900 dark:text-stone-100 truncate">
					{value}
				</div>
			</CardContent>
		</Card>
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

function formatDate(input: string): string {
	if (!input) return "—";
	const d = new Date(input);
	if (Number.isNaN(d.getTime())) return input;
	return d.toLocaleString();
}
