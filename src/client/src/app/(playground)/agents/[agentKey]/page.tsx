"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
	Activity,
	BookText,
	LayoutDashboard,
	LayoutGrid,
	Loader2,
	Settings,
} from "lucide-react";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import { useDynamicBreadcrumbs } from "@/utils/hooks/useBreadcrumbs";
import getMessage from "@/constants/messages";
import type { AgentVersion, UnifiedAgent } from "@/types/agents";
import type { VersionFilter } from "@/types/store/filter";
import { useAgentIntent } from "@/selectors/agents-instrumentation";
import { getObservabilityView } from "@/lib/platform/agents/observability-view";
import AgentHeader from "@/components/(playground)/agents/agent-header";
import AgentScopeProvider from "@/components/(playground)/agents/agent-scope-provider";
import AgentOverviewTab from "@/components/(playground)/agents/agent-overview-tab";
import LifecycleActions from "@/components/(playground)/agents/lifecycle-actions";
import VersionTimeline, {
	VersionChooser,
} from "@/components/(playground)/agents/version-timeline";

// Heavy tabs are dynamically imported so the initial detail-page payload
// only loads what the Overview tab needs. LLMDashboard pulls echarts +
// most platform aggregators, RequestsPage pulls the entire traces + json
// viewer stack — both are wasted bytes for a user who lands on Overview
// and never switches tabs. Configuration and the Definition tab also
// carry editor/viewer code we only need on demand.
const LLMDashboard = dynamic(
	() => import("@/app/(playground)/dashboard/llm"),
	{
		loading: () => <TabLoading label={getMessage().AGENTS_LOADING_DASHBOARD} />,
		ssr: false,
	}
);
const RequestsPage = dynamic(
	() => import("@/components/(playground)/agents/agent-monitoring-tab"),
	{
		loading: () => <TabLoading label={getMessage().AGENTS_LOADING_REQUESTS} />,
		ssr: false,
	}
);
const Filter = dynamic(() => import("@/components/(playground)/filter"), {
	loading: () => null,
	ssr: false,
});
const AgentConfigurationTab = dynamic(
	() => import("@/components/(playground)/agents/agent-configuration-tab"),
	{
		loading: () => <TabLoading label={getMessage().AGENTS_LOADING_CONFIGURATION} />,
		ssr: false,
	}
);
const ToolsCard = dynamic(
	() => import("@/components/(playground)/agents/tools-card"),
	{ loading: () => null, ssr: false }
);
const SystemPromptCard = dynamic(
	() => import("@/components/(playground)/agents/system-prompt-card"),
	{ loading: () => null, ssr: false }
);
const VersionDrawer = dynamic(
	() => import("@/components/(playground)/agents/version-drawer"),
	{ loading: () => null, ssr: false }
);
const CodingAgentDetail = dynamic(
	() =>
		import(
			"@/components/(playground)/coding-agents/coding-agent-detail"
		),
	{
		loading: () => <TabLoading label={getMessage().AGENTS_LOADING_SERVICE_DETAILS} />,
		ssr: false,
	}
);

type AgentDetailTab =
	| "overview"
	| "dashboard"
	| "monitoring"
	| "definition"
	| "configuration"
	| "sessions"
	// Coding-agent-only tab (`UnifiedAgent.source === "coding"`). Was
	// missing from VALID_TABS, so clicks on the Users tab fell back to
	// "overview" via `coerceTab`.
	| "users";

const VALID_TABS: AgentDetailTab[] = [
	"overview",
	"dashboard",
	"monitoring",
	"definition",
	"configuration",
	"sessions",
	"users",
];

function coerceTab(value: string | null): AgentDetailTab {
	if (value && (VALID_TABS as string[]).includes(value)) {
		return value as AgentDetailTab;
	}
	return "overview";
}

export default function AgentDetailPage() {
	const params = useParams<{ agentKey: string }>();
	const router = useRouter();
	const searchParams = useSearchParams();
	const agentKey = params.agentKey;

	const urlTab = coerceTab(searchParams.get("tab"));
	const urlVersionHash = searchParams.get("versionHash");

	const [agent, setAgent] = useState<UnifiedAgent | null>(null);
	const [latestVersion, setLatestVersion] = useState<AgentVersion | null>(null);
	const [versions, setVersions] = useState<AgentVersion[]>([]);
	const [selectedVersion, setSelectedVersion] = useState<AgentVersion | null>(
		null
	);
	const [versionFilter, setVersionFilter] = useState<VersionFilter | null>(
		null
	);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [versionsOpen, setVersionsOpen] = useState(false);

	const fetchAgent = useCallback(async () => {
		try {
			const res = await fetch(`/api/agents/${agentKey}/snapshot`);
			if (res.status === 404) {
				setError("Agent not found");
				setAgent(null);
				return;
			}
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			const body = await res.json();
			setAgent((body.data?.agent as UnifiedAgent) || null);
			setLatestVersion((body.data?.version as AgentVersion) || null);
			setError(null);
		} catch (e) {
			setError(String(e));
		}
	}, [agentKey]);

	// Initial detail-page load: snapshot and versions are independent reads,
	// so we fire them in parallel and only block the spinner on snapshot.
	// Versions populates the timeline + chooser without blocking the shell.
	useEffect(() => {
		let cancelled = false;
		setLoading(true);

		const snapshotPromise = fetchAgent();
		const versionsPromise = (async () => {
			try {
				const res = await fetch(`/api/agents/${agentKey}/versions`);
				if (!res.ok) return;
				const body = await res.json();
				if (cancelled) return;
				setVersions((body.data as AgentVersion[]) || []);
			} catch {
				/* swallow — UI still works without the full list */
			}
		})();

		(async () => {
			await snapshotPromise;
			if (!cancelled) setLoading(false);
		})();

		return () => {
			cancelled = true;
			// Don't actually abort the in-flight versions request — its
			// resolution still safely no-ops via the `cancelled` guard, and
			// abort cleanup is unnecessary for these short reads.
			void versionsPromise;
		};
	}, [agentKey, fetchAgent]);

	const effectiveVersionHash = useMemo(() => {
		if (urlVersionHash) return urlVersionHash;
		return latestVersion?.version_hash || null;
	}, [urlVersionHash, latestVersion]);

	// Mirror the list page's pendingKeys-driven polling. While either feature
	// is transitioning for this agent (optimistic intent in flight or server
	// shows desired_mismatch / pending action), refetch the snapshot at
	// 2.5s → 5s → 10s → 30s backoff. When steady, drop to the 30s baseline
	// so the page still picks up async materialization without manual
	// refresh. Without this, the detail page would freeze on its initial
	// fetch while the table advances within seconds.
	const llmIntent = useAgentIntent(agentKey, "llm");
	const agentIntent = useAgentIntent(agentKey, "agent");
	const lifecycleIntent = useAgentIntent(agentKey, "lifecycle");
	const detailTransitioning = useMemo(() => {
		if (!agent) return false;
		if (
			getObservabilityView(agent, "llm", llmIntent).transitioning ||
			getObservabilityView(agent, "agent", agentIntent).transitioning ||
			getObservabilityView(agent, "lifecycle", lifecycleIntent).transitioning
		) {
			return true;
		}
		return false;
	}, [agent, llmIntent, agentIntent, lifecycleIntent]);

	const detailPollInFlightRef = useRef(false);

	useEffect(() => {
		let cancelled = false;
		let timer: number | null = null;
		const baseDelay = 2500;
		const maxDelay = 30_000;
		let nextDelay = detailTransitioning ? baseDelay : maxDelay;

		const tick = async () => {
			if (cancelled) return;
			if (!detailPollInFlightRef.current) {
				detailPollInFlightRef.current = true;
				try {
					await fetchAgent();
				} finally {
					detailPollInFlightRef.current = false;
				}
			}
			if (cancelled) return;
			if (detailTransitioning) {
				nextDelay = Math.min(nextDelay * 2, maxDelay);
			} else {
				nextDelay = maxDelay;
			}
			timer = window.setTimeout(tick, nextDelay);
		};

		timer = window.setTimeout(tick, nextDelay);

		return () => {
			cancelled = true;
			if (timer !== null) window.clearTimeout(timer);
		};
	}, [agentKey, detailTransitioning, fetchAgent]);

	useEffect(() => {
		let cancelled = false;
		if (!effectiveVersionHash) {
			setSelectedVersion(null);
			setVersionFilter(null);
			return;
		}
		(async () => {
			try {
				const [vRes, fRes] = await Promise.all([
					fetch(`/api/agents/${agentKey}/versions/${effectiveVersionHash}`),
					fetch(
						`/api/agents/${agentKey}/versions/${effectiveVersionHash}/window`
					),
				]);
				if (!cancelled && vRes.ok) {
					const body = await vRes.json();
					setSelectedVersion((body.data as AgentVersion) || null);
				}
				if (!cancelled && fRes.ok) {
					const body = await fRes.json();
					setVersionFilter((body.data as VersionFilter) || null);
				}
			} catch {
				/* keep last value */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [agentKey, effectiveVersionHash]);

	const updateQuery = useCallback(
		(updates: Record<string, string | null>) => {
			const next = new URLSearchParams(searchParams?.toString() ?? "");
			for (const [key, value] of Object.entries(updates)) {
				if (value === null || value === "") next.delete(key);
				else next.set(key, value);
			}
			const qs = next.toString();
			router.replace(qs ? `?${qs}` : "?", { scroll: false });
		},
		[router, searchParams]
	);

	const handleTabChange = useCallback(
		(value: string) => {
			updateQuery({ tab: value === "overview" ? null : value });
		},
		[updateQuery]
	);

	const handleSelectVersion = useCallback(
		(hash: string | null) => {
			updateQuery({ versionHash: hash });
		},
		[updateQuery]
	);

	useDynamicBreadcrumbs(
		{
			title:
				agent?.service_name ||
				getMessage().AGENTS_SERVICE_DETAIL_DEFAULT_TITLE,
		},
		[agent?.service_name]
	);

	if (loading && !agent) {
		return (
			<div className="flex items-center justify-center h-full text-stone-500 dark:text-stone-400 text-sm gap-2">
				<Loader2 className="w-4 h-4 animate-spin" />
				{getMessage().AGENTS_LOADING_SERVICE_DETAILS}
			</div>
		);
	}

	if (error || !agent) {
		// Even on a 404 we honor `?from=<tab>` so a failed deep-link
		// from the Coding Agents tab still routes back to Coding
		// Agents rather than tossing the user back to Applications.
		const fromParam = searchParams.get("from");
		const backHref =
			fromParam === "coding"
				? "/agents?tab=coding"
				: fromParam === "controllers"
					? "/agents?tab=controllers"
					: "/agents";
		return (
			<div className="flex flex-col items-center justify-center h-full text-stone-500 dark:text-stone-400 text-sm gap-3">
				<div>{error || "Agent not found"}</div>
				<button
					onClick={() => router.push(backHref)}
					className="text-stone-700 dark:text-stone-200 underline"
				>
					{getMessage().AGENTS_BACK_TO_HUB}
				</button>
			</div>
		);
	}

	const activeVersion = selectedVersion || latestVersion;
	const scopedVersionFilter = urlVersionHash ? versionFilter : null;
	const isCodingAgent = agent.source === "coding";

	// Pulses an attention dot on the Configuration tab when a
	// controller-discovered agent has no telemetry yet. Two guards prevent
	// false positives: (a) only controller-only rows (SDK agents always
	// have data by definition); (b) both 24h request count AND known
	// versions are zero so we don't blink for agents that simply went
	// quiet recently. We only blink when no telemetry has ever materialized.
	const needsInstrumentation =
		agent.source === "controller" &&
		(agent.request_count_24h ?? 0) === 0 &&
		versions.length === 0;

	return (
		<AgentScopeProvider
			serviceName={agent.service_name}
			environment={agent.environment}
			versionFilter={scopedVersionFilter}
		>
			<div className="flex flex-col w-full h-full gap-5 overflow-y-auto p-1 pb-8">
				<AgentHeader
					agent={agent}
					onRefresh={fetchAgent}
					rightSlot={
						isCodingAgent ? null : (
							<div className="flex items-center gap-2">
								<LifecycleActions
									agent={agent}
									onRefresh={fetchAgent}
									variant="header"
								/>
								<VersionChooser
									versions={versions}
									selectedHash={urlVersionHash}
									onSelectVersion={handleSelectVersion}
									onOpenAllVersions={() => setVersionsOpen(true)}
								/>
							</div>
						)
					}
				/>

				{isCodingAgent ? (
					<CodingAgentDetail
						agent={agent}
						tab={urlTab}
						onTabChange={handleTabChange}
					/>
				) : (
					<>
						<VersionTimeline
							agentKey={agent.agent_key}
							versions={versions}
							selectedHash={urlVersionHash}
						/>
						<TraditionalAgentTabs
							agent={agent}
							versions={versions}
							urlTab={urlTab}
							urlVersionHash={urlVersionHash}
							handleTabChange={handleTabChange}
							effectiveVersionHash={effectiveVersionHash}
							activeVersion={activeVersion}
							needsInstrumentation={needsInstrumentation}
							fetchAgent={fetchAgent}
							versionsOpen={versionsOpen}
							setVersionsOpen={setVersionsOpen}
						/>
					</>
				)}
			</div>
		</AgentScopeProvider>
	);
}

interface TraditionalAgentTabsProps {
	agent: UnifiedAgent;
	versions: AgentVersion[];
	urlTab: AgentDetailTab;
	urlVersionHash: string | null;
	handleTabChange: (value: string) => void;
	effectiveVersionHash: string | null;
	activeVersion: AgentVersion | null;
	needsInstrumentation: boolean;
	fetchAgent: () => Promise<void>;
	versionsOpen: boolean;
	setVersionsOpen: (open: boolean) => void;
}

function TraditionalAgentTabs({
	agent,
	versions,
	urlTab,
	handleTabChange,
	effectiveVersionHash,
	activeVersion,
	needsInstrumentation,
	fetchAgent,
	versionsOpen,
	setVersionsOpen,
}: TraditionalAgentTabsProps) {
	return (
		<>
			<Tabs
					value={urlTab}
					onValueChange={handleTabChange}
					className="w-full"
				>
					<TabsList className="h-auto rounded-none border-b border-stone-200 dark:border-stone-800 bg-transparent p-0 w-full justify-start gap-1">
						<UnderlineTab
							value="overview"
							icon={<LayoutGrid className="w-3.5 h-3.5" />}
							label={getMessage().AGENTS_TAB_OVERVIEW}
						/>
						<UnderlineTab
							value="dashboard"
							icon={<LayoutDashboard className="w-3.5 h-3.5" />}
							label={getMessage().AGENTS_TAB_DASHBOARD}
						/>
						<UnderlineTab
							value="monitoring"
							icon={<Activity className="w-3.5 h-3.5" />}
							label={getMessage().AGENTS_TAB_MONITORING}
						/>
						<UnderlineTab
							value="definition"
							icon={<BookText className="w-3.5 h-3.5" />}
							label={getMessage().AGENTS_TAB_DEFINITION}
						/>
						<UnderlineTab
							value="configuration"
							icon={<Settings className="w-3.5 h-3.5" />}
							label={getMessage().AGENTS_TAB_CONFIGURATION}
							indicator={needsInstrumentation}
							indicatorTooltip={
								getMessage().AGENTS_TAB_CONFIGURATION_NEEDS_INSTRUMENTATION
							}
						/>
					</TabsList>

					<TabsContent value="overview" className="mt-4">
						<AgentOverviewTab
							agent={agent}
							versionHash={effectiveVersionHash}
						/>
					</TabsContent>

					<TabsContent value="dashboard" className="mt-4">
						<div className="space-y-3">
							<Filter />
							<LLMDashboard />
						</div>
					</TabsContent>

					<TabsContent value="monitoring" className="mt-4">
						<RequestsPage />
					</TabsContent>

					<TabsContent value="definition" className="mt-4">
						{activeVersion ? (
							<div className="space-y-4">
								<SystemPromptCard prompt={activeVersion.system_prompt} />
								<ToolsCard tools={activeVersion.tools} />
							</div>
						) : (
							<EmptyVersion />
						)}
					</TabsContent>

					<TabsContent value="configuration" className="mt-4">
						<AgentConfigurationTab agent={agent} onRefresh={fetchAgent} />
					</TabsContent>
				</Tabs>

			<VersionDrawer
				agentKey={agent.agent_key}
				open={versionsOpen}
				onClose={() => setVersionsOpen(false)}
				initialVersions={versions}
			/>
		</>
	);
}

function UnderlineTab({
	value,
	icon,
	label,
	indicator,
	indicatorTooltip,
}: {
	value: string;
	icon: React.ReactNode;
	label: string;
	indicator?: boolean;
	indicatorTooltip?: string;
}) {
	return (
		<TabsTrigger
			value={value}
			className="rounded-none border-b-2 border-transparent bg-transparent shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-stone-900 dark:data-[state=active]:text-stone-100 data-[state=active]:shadow-none px-3 py-2 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 -mb-px flex items-center gap-1.5 relative"
		>
			{icon}
			{label}
			{indicator && (
				<span
					role="status"
					aria-label={indicatorTooltip}
					title={indicatorTooltip}
					className="ml-1 inline-flex w-2 h-2 rounded-full bg-orange-500 motion-safe:animate-pulse"
				/>
			)}
		</TabsTrigger>
	);
}

function EmptyVersion() {
	return (
		<div className="border dark:border-stone-800 rounded-lg p-6 text-sm text-stone-500 dark:text-stone-400">
			No version selected.
		</div>
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
