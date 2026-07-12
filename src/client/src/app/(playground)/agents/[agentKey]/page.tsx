"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useDynamicBreadcrumbs } from "@/utils/hooks/useBreadcrumbs";
import getMessage from "@/constants/messages";
import type { AgentVersion, UnifiedAgent } from "@/types/agents";
import type { VersionFilter } from "@/types/store/filter";
import { useAgentIntent } from "@/selectors/agents-instrumentation";
import { getObservabilityView } from "@/lib/platform/agents/observability-view";
import AgentHeader, {
	AgentPillTab,
} from "@/components/(playground)/agents/agent-header";
import AgentScopeProvider from "@/components/(playground)/agents/agent-scope-provider";
import AgentOverviewTab from "@/components/(playground)/agents/agent-overview-tab";
import LifecycleActions from "@/components/(playground)/agents/lifecycle-actions";
import { VersionChooser } from "@/components/(playground)/agents/version-timeline";

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
			<div className="flex h-full w-full flex-col overflow-hidden">
				<div className="border-b border-stone-200 px-4 py-3 dark:border-stone-800">
					<div className="h-8 w-48 animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
				</div>
				<div className="flex flex-1 items-center justify-center gap-2 p-4 text-sm text-stone-500 dark:text-stone-400">
					<Loader2 className="h-4 w-4 animate-spin" />
					{getMessage().AGENTS_LOADING_SERVICE_DETAILS}
				</div>
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
			<div className="flex h-full w-full flex-col overflow-hidden">
				<div className="border-b border-stone-200 px-4 py-3 dark:border-stone-800">
					<button
						onClick={() => router.push(backHref)}
						className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-stone-600 transition hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
						title={getMessage().AGENTS_BACK_TO_HUB}
						aria-label={getMessage().AGENTS_BACK_TO_HUB}
					>
						<ArrowLeft className="h-3.5 w-3.5" />
					</button>
				</div>
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-sm text-stone-500 dark:text-stone-400">
					<div>{error || "Agent not found"}</div>
				</div>
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

	const traditionalTabs = (
		<div className="flex flex-wrap items-center gap-2">
			{(
				[
					{ id: "overview", label: getMessage().AGENTS_TAB_OVERVIEW },
					{ id: "dashboard", label: getMessage().AGENTS_TAB_DASHBOARD },
					{ id: "monitoring", label: getMessage().AGENTS_TAB_MONITORING },
					{ id: "definition", label: getMessage().AGENTS_TAB_DEFINITION },
					{
						id: "configuration",
						label: getMessage().AGENTS_TAB_CONFIGURATION,
						indicator: needsInstrumentation,
						indicatorTooltip:
							getMessage().AGENTS_TAB_CONFIGURATION_NEEDS_INSTRUMENTATION,
					},
				] as const
			).map((tab) => (
				<AgentPillTab
					key={tab.id}
					active={urlTab === tab.id}
					label={tab.label}
					onClick={() => handleTabChange(tab.id)}
					indicator={"indicator" in tab ? tab.indicator : undefined}
					indicatorTooltip={
						"indicatorTooltip" in tab ? tab.indicatorTooltip : undefined
					}
				/>
			))}
		</div>
	);

	const codingTabs = (
		<div className="flex flex-wrap items-center gap-2">
			{(
				[
					{ id: "overview", label: getMessage().AGENTS_TAB_OVERVIEW },
					{ id: "sessions", label: getMessage().AGENTS_CODING_TAB_SESSIONS },
					{ id: "users", label: getMessage().AGENTS_CODING_USERS_SHORT_LABEL },
				] as const
			).map((tab) => (
				<AgentPillTab
					key={tab.id}
					active={urlTab === tab.id}
					label={tab.label}
					onClick={() => handleTabChange(tab.id)}
				/>
			))}
		</div>
	);

	return (
		<AgentScopeProvider
			serviceName={agent.service_name}
			environment={agent.environment}
			versionFilter={scopedVersionFilter}
		>
			{/* Match the agents hub chrome: FeaturePageHeader (full-bleed
			    top bar with pill tabs) + p-4 padded content below. */}
			<div className="flex h-full w-full flex-col overflow-hidden">
				<AgentHeader
					agent={agent}
					onRefresh={fetchAgent}
					tabs={isCodingAgent ? codingTabs : traditionalTabs}
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

				<section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
					{isCodingAgent ? (
						<CodingAgentDetail
							agent={agent}
							tab={urlTab}
							onTabChange={handleTabChange}
						/>
					) : (
						<TraditionalAgentTabs
							agent={agent}
							versions={versions}
							urlTab={urlTab}
							urlVersionHash={urlVersionHash}
							handleTabChange={handleTabChange}
							effectiveVersionHash={effectiveVersionHash}
							activeVersion={activeVersion}
							fetchAgent={fetchAgent}
							versionsOpen={versionsOpen}
							setVersionsOpen={setVersionsOpen}
						/>
					)}
				</section>
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
	fetchAgent,
	versionsOpen,
	setVersionsOpen,
}: TraditionalAgentTabsProps) {
	// Tab pills live in FeaturePageHeader (same surface as the agents
	// hub). This component only owns the tab panels.
	return (
		<>
			<Tabs
				value={urlTab}
				onValueChange={handleTabChange}
				className="w-full"
			>
				<TabsContent value="overview" className="mt-0">
					<AgentOverviewTab
						agent={agent}
						versionHash={effectiveVersionHash}
					/>
				</TabsContent>

				<TabsContent value="dashboard" className="mt-0">
					<div className="space-y-3">
						<Filter />
						<LLMDashboard />
					</div>
				</TabsContent>

				<TabsContent value="monitoring" className="mt-0">
					<RequestsPage />
				</TabsContent>

				<TabsContent value="definition" className="mt-0">
					{activeVersion ? (
						<div className="space-y-4">
							<SystemPromptCard prompt={activeVersion.system_prompt} />
							<ToolsCard tools={activeVersion.tools} />
						</div>
					) : (
						<EmptyVersion />
					)}
				</TabsContent>

				<TabsContent value="configuration" className="mt-0">
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
