"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { RefreshCw, Plus } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";
import {
	getAgentIntents,
	getClearAgentIntent,
	getPruneExpiredAgentIntents,
} from "@/selectors/agents-instrumentation";
import type { Feature } from "@/types/store/agents-instrumentation";
import { getObservabilityView } from "@/lib/platform/agents/observability-view";
import { getPingStatus } from "@/selectors/database-config";
import { TIME_RANGE_TYPE } from "@/store/filter";
import type { ControllerInstance } from "@/types/controller";
import type { UnifiedAgent } from "@/types/agents";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import ComboDropdown from "@/components/(playground)/filter/combo-dropdown";
import Filter from "@/components/(playground)/filter";
import getMessage from "@/constants/messages";
import NoController from "./no-controller";
import ServiceTable from "./service-table";
import ControllerTable from "./controller-table";
import CodingAgentsTable from "./coding-agents-table";

type Tab = "services" | "controllers" | "coding";

function coerceTab(value: string | null): Tab {
	if (value === "controllers") return "controllers";
	if (value === "coding") return "coding";
	return "services";
}

export default function AgentsPage() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const initialTab = coerceTab(searchParams.get("tab"));
	const [activeTab, setActiveTabState] = useState<Tab>(initialTab);
	const [showSetupModal, setShowSetupModal] = useState(false);
	const [serviceRows, setServiceRows] = useState<UnifiedAgent[]>([]);
	const [controllerRows, setControllerRows] = useState<ControllerInstance[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [isLoadingMore, setIsLoadingMore] = useState(false);

	const [systemFilter, setSystemFilter] = useState<string[]>([]);
	const [providerFilter, setProviderFilter] = useState<string[]>([]);
	const [statusFilter, setStatusFilter] = useState<string[]>([]);
	const [refreshError, setRefreshError] = useState<string | null>(null);

	const setActiveTab = useCallback((tab: Tab) => {
		setActiveTabState(tab);
		const params = new URLSearchParams(window.location.search);
		if (tab === "services") {
			params.delete("tab");
		} else {
			params.set("tab", tab);
		}
		const qs = params.toString();
		router.replace(`/agents${qs ? `?${qs}` : ""}`, { scroll: false });
	}, [router]);

	useEffect(() => {
		setActiveTabState(coerceTab(searchParams.get("tab")));
	}, [searchParams]);

	// Auto-redirect to the Coding Agents tab when it's the only place
	// with data. Without this, a user with no controllers and no SDK
	// rows lands on an empty Applications tab and has to discover the
	// "Coding Agents" tab themselves — a bad first-run experience for
	// anyone who installed the host plugins before the controller.
	// Only fires:
	//   - when the URL didn't pin a tab (so we don't fight the user's
	//     navigation),
	//   - while the apps view is empty AND the coding view has rows,
	//   - exactly once after data first lands.
	const didAutoRouteRef = useRef(false);

	const pathname = usePathname();
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);
	const pingStatus = useRootStore(getPingStatus);
	const agentIntents = useRootStore(getAgentIntents);
	const clearIntent = useRootStore(getClearAgentIntent);
	const pruneExpiredIntents = useRootStore(getPruneExpiredAgentIntents);

	const {
		fireRequest: fetchInstances,
		isFetched: instancesFetched,
		isLoading: instancesLoading,
	} = useFetchWrapper<ControllerInstance[]>();
	const [servicesLoading, setServicesLoading] = useState(false);
	const [servicesFetched, setServicesFetched] = useState(false);

	const fetchAgents = useCallback(
		async (cursor: string | null, source?: "coding") => {
			const params = new URLSearchParams();
			if (filter.timeLimit.start)
				params.set("start", new Date(filter.timeLimit.start).toISOString());
			// Only pin an upper bound for explicit custom ranges. For relative
			// ranges (24H/7D/1M/3M), the server uses "now" implicitly, which
			// avoids hiding freshly materialized rows whose `last_seen` is just
			// past the captured page-load `end`.
			if (
				filter.timeLimit.type === TIME_RANGE_TYPE.CUSTOM &&
				filter.timeLimit.end
			) {
				params.set("end", new Date(filter.timeLimit.end).toISOString());
			}
			if (cursor) params.set("cursor", cursor);
			if (providerFilter.length > 0) {
				params.set("providers", providerFilter.join(","));
			}
			if (statusFilter.length > 0) {
				params.set("statuses", statusFilter.join(","));
			}
			// `source=coding` is required to fetch coding-agent rows;
			// without it the API returns only Apps rows. This split is
			// what keeps coding rows from ever appearing in the Apps
			// tab, even for one render frame.
			if (source) {
				params.set("source", source);
			}
			const res = await fetch(`/api/agents?${params.toString()}`);
			if (!res.ok) {
				const txt = await res.text().catch(() => "");
				throw new Error(txt || `HTTP ${res.status}`);
			}
			return (await res.json()) as {
				data: UnifiedAgent[];
				nextCursor: string | null;
			};
		},
		[
			filter.timeLimit.start,
			filter.timeLimit.end,
			filter.timeLimit.type,
			providerFilter,
			statusFilter,
		]
	);

	const [codingRowsState, setCodingRowsState] = useState<UnifiedAgent[]>([]);

	const refresh = useCallback(() => {
		setRefreshError(null);
		fetchInstances({
			requestType: "GET",
			url: "/api/controller/instances",
			responseDataKey: "data",
			successCb: (data) => {
				setControllerRows(data || []);
			},
			failureCb: (err: any) => setRefreshError(String(err)),
		});
		setServicesLoading(true);
		// Two parallel reads: Apps (default — server excludes coding)
		// and Coding Agents (?source=coding). Settling them
		// independently keeps a slow coding-rollup query from blocking
		// the Apps tab from rendering, and vice versa.
		Promise.allSettled([
			fetchAgents(null),
			fetchAgents(null, "coding"),
		])
			.then(([apps, coding]) => {
				if (apps.status === "fulfilled") {
					setServiceRows(apps.value.data || []);
					setNextCursor(apps.value.nextCursor || null);
				} else {
					setRefreshError(String(apps.reason));
				}
				if (coding.status === "fulfilled") {
					setCodingRowsState(coding.value.data || []);
				}
				setServicesFetched(true);
			})
			.finally(() => setServicesLoading(false));
	}, [fetchInstances, fetchAgents]);

	const loadMore = useCallback(() => {
		if (!nextCursor || isLoadingMore) return;
		setIsLoadingMore(true);
		fetchAgents(nextCursor)
			.then((payload) => {
				setServiceRows((prev) => [...prev, ...((payload.data as UnifiedAgent[]) || [])]);
				setNextCursor(payload.nextCursor || null);
			})
			.catch((err: unknown) => setRefreshError(String(err)))
			.finally(() => setIsLoadingMore(false));
	}, [fetchAgents, isLoadingMore, nextCursor]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		)
			refresh();
	}, [
		filter.timeLimit.start,
		filter.timeLimit.end,
		pingStatus,
		providerFilter,
		statusFilter,
	]);

	useEffect(() => {
		if (!pathname.startsWith("/agents")) return;
		if (filter.timeLimit.type === TIME_RANGE_TYPE.CUSTOM) return;

		updateFilter("timeLimit.type", filter.timeLimit.type);
	}, [pathname, filter.timeLimit.type, updateFilter]);

	// Computes the agent_keys that currently have controller-managed work in
	// flight. Single source of truth = the same `getObservabilityView` the
	// UI uses, so the polling cadence and the rendered spinner state can
	// never disagree. We treat an agent as "pending" when *any* of:
	//   - it has an unexpired optimistic intent in the Zustand store,
	//   - the controller has at least one pod pending acknowledgement, or
	//   - the LLM or Agent observability view resolves to `transitioning`.
	const pendingKeys = useMemo(() => {
		const keys = new Set<string>();
		for (const service of serviceRows) {
			if (service.source === "sdk") continue;
			const podsPending = service.pods_pending ?? 0;
			const llmTransitioning = getObservabilityView(
				service,
				"llm",
				null
			).transitioning;
			const agentTransitioning = getObservabilityView(
				service,
				"agent",
				null
			).transitioning;
			const lifecycleTransitioning = getObservabilityView(
				service,
				"lifecycle",
				null
			).transitioning;
			if (
				podsPending > 0 ||
				llmTransitioning ||
				agentTransitioning ||
				lifecycleTransitioning
			) {
				keys.add(service.agent_key);
			}
		}
		for (const agentKey of Object.keys(agentIntents)) {
			if (Object.keys(agentIntents[agentKey] || {}).length > 0) {
				keys.add(agentKey);
			}
		}
		return Array.from(keys);
	}, [serviceRows, agentIntents]);

	// Dedupe in-flight polling work so a slow ClickHouse query can't stack
	// retries on top of each other and flood the API. Ref-based so the guard
	// survives across setTimeout boundaries without re-running the effect.
	const pollInFlightRef = useRef(false);

	// Targeted refresh: fetch only the rows currently in pending/transitioning
	// state instead of re-fetching the whole list every tick. Falls back to
	// the full list refresh if too many rows are pending (then it's cheaper
	// to do one list query than N row queries).
	const refreshPendingRows = useCallback(async () => {
		if (pendingKeys.length === 0) return;
		if (pendingKeys.length > 25) {
			refresh();
			return;
		}
		try {
			const updates = await Promise.all(
				pendingKeys.map((key) =>
					fetch(`/api/agents/${encodeURIComponent(key)}`)
						.then((res) => (res.ok ? res.json() : null))
						.catch(() => null)
				)
			);
			const updatedByKey = new Map<string, UnifiedAgent>();
			for (const payload of updates) {
				const agent = (payload as { data?: UnifiedAgent } | null)?.data;
				if (agent && agent.agent_key) updatedByKey.set(agent.agent_key, agent);
			}
			if (updatedByKey.size === 0) return;
			setServiceRows((prev) =>
				prev.map((row) => updatedByKey.get(row.agent_key) || row)
			);
			// Reconcile optimistic intents on convergence only. We keep the
			// optimistic spinner up until the controller actually reports the
			// state we intended -- i.e. server-truth resolves to a non-
			// transitioning view whose `enabled` matches the intent direction.
			//
			// Why "convergence-only" instead of also clearing on "no pending
			// action": once a controller action moves to `completed`/`failed`
			// it drops out of pod_action_latest (HAVING status IN
			// ('pending','acknowledged')), so `pending_action` empties the
			// moment the controller is done -- BEFORE the new
			// `agent_observability_status` heartbeat arrives. The old "no
			// pending action -> clear" branch would snap the spinner back to
			// the previous state in that gap; with multi-pod fleets and 60s
			// controller polls this gap can be tens of seconds long. The 5
			// minute optimistic TTL (see agents-instrumentation store) is the
			// only time-based safety net.
			Array.from(updatedByKey.entries()).forEach(([agentKey, agent]) => {
				const intentsForAgent = agentIntents[agentKey];
				if (!intentsForAgent) return;
				for (const feature of Object.keys(intentsForAgent) as Feature[]) {
					const intent = intentsForAgent[feature];
					if (!intent) continue;
					const serverView = getObservabilityView(agent, feature, null);
					if (serverView.transitioning) continue;
					// For lifecycle, `restarting` collapses back to `running`
					// once the controller is done. We treat it like `starting`
					// for convergence purposes -- the workload is up, so the
					// intent has resolved.
					const intentTargetEnabled =
						intent.direction === "enabling" ||
						intent.direction === "starting" ||
						intent.direction === "restarting";
					if (serverView.enabled === intentTargetEnabled) {
						clearIntent(agentKey, feature);
					}
				}
			});
		} catch (err) {
			setRefreshError(String(err));
		}
	}, [pendingKeys, refresh, agentIntents, clearIntent]);

	// Exponential backoff polling: while controller actions are in flight,
	// poll at 2.5s → 5s → 10s → 30s (cap), and reset to 2.5s on every state
	// change. When nothing is pending, fall back to a 30s baseline refresh
	// of the full list so newly materialized agents still appear without a
	// manual click.
	useEffect(() => {
		let cancelled = false;
		let timer: number | null = null;
		const baseDelay = 2500;
		const maxDelay = 30_000;
		let nextDelay = pendingKeys.length > 0 ? baseDelay : maxDelay;

		const tick = async () => {
			if (cancelled) return;
			// Drop any optimistic intents older than their TTL each tick.
			// Cheap (in-memory map walk) and avoids leaking spinner state
			// when the API call never came back.
			pruneExpiredIntents();
			if (!pollInFlightRef.current) {
				pollInFlightRef.current = true;
				try {
					if (pendingKeys.length > 0) {
						await refreshPendingRows();
					} else {
						refresh();
					}
				} finally {
					pollInFlightRef.current = false;
				}
			}
			if (cancelled) return;
			// Exponential backoff only matters while there is pending work to
			// observe; the baseline (non-pending) cadence is a flat maxDelay.
			if (pendingKeys.length > 0) {
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
	}, [pendingKeys, refresh, refreshPendingRows, pruneExpiredIntents]);

	const isLoading = instancesLoading || servicesLoading;
	const hasControllers = controllerRows.length > 0;

	// Coding-agent rows live on a dedicated tab and a dedicated fetch
	// (`?source=coding`). The Apps tab gets the default fetch which
	// the server filters to controller/sdk/both. We still defensively
	// strip any coding row that somehow ends up in `serviceRows`
	// (e.g. an older browser tab whose API filter regressed) by
	// double-checking both `source` and the synthetic `coding` cluster
	// id we stamp at materialization time.
	// Coding-only first-run redirect. We wait for `servicesFetched` so
	// we don't bounce the tab on the first paint before either fetch
	// has resolved. Once data lands and the only signal is coding
	// telemetry, switch the user to that tab and pin it via
	// `setActiveTab` (which also writes ?tab=coding into the URL so a
	// browser refresh stays put).
	useEffect(() => {
		if (didAutoRouteRef.current) return;
		if (!servicesFetched) return;
		if (searchParams.get("tab")) return;
		const onlyCoding =
			!hasControllers &&
			serviceRows.length === 0 &&
			codingRowsState.length > 0;
		if (onlyCoding) {
			didAutoRouteRef.current = true;
			setActiveTab("coding");
		}
	}, [
		servicesFetched,
		hasControllers,
		serviceRows.length,
		codingRowsState.length,
		searchParams,
		setActiveTab,
	]);

	const applicationRows = useMemo(
		() =>
			serviceRows.filter(
				(s) => s.source !== "coding" && s.cluster_id !== "coding"
			),
		[serviceRows]
	);
	const codingRows = codingRowsState;

	const activeControllers = controllerRows.filter(
		(c) => (c.computed_status || c.status) !== "inactive"
	);
	const staleCount = controllerRows.length - activeControllers.length;
	const totalServices = applicationRows.length;
	const instrumentedServices = applicationRows.filter(
		(s) =>
			s.source === "sdk" ||
			s.source === "both" ||
			s.instrumentation_status === "instrumented" ||
			s.desired_agent_status === "enabled"
	).length;

	const allProviders = useMemo(() => {
		const set = new Set<string>();
		for (const svc of serviceRows) {
			for (const p of svc.providers || []) set.add(p);
		}
		return Array.from(set).sort();
	}, [serviceRows]);

	const allSystems = useMemo(() => {
		const set = new Set<string>();
		for (const inst of controllerRows) {
			set.add(inst.mode === "kubernetes" ? "kubernetes" : inst.mode === "docker" ? "docker" : "linux");
		}
		return Array.from(set).sort();
	}, [controllerRows]);

	const handleStatClick = (stat: "controllers" | "discovered" | "instrumented") => {
		if (stat === "controllers") {
			setActiveTab("controllers");
		} else if (stat === "discovered") {
			setActiveTab("services");
			setStatusFilter([]);
		} else {
			setActiveTab("services");
			setStatusFilter(["instrumented"]);
		}
	};

	const updateFilterValues = useCallback(
		(type: string, value: string, operationType?: string) => {
			const setter =
				type === "system"
					? setSystemFilter
					: type === "provider"
						? setProviderFilter
						: setStatusFilter;
			setter((prev) =>
				operationType === "delete"
					? prev.filter((v) => v !== value)
					: prev.includes(value) ? prev : [...prev, value]
			);
		},
		[]
	);

	const clearFilterItem = useCallback((type: string) => {
		const setter =
			type === "system"
				? setSystemFilter
				: type === "provider"
					? setProviderFilter
					: setStatusFilter;
		setter([]);
	}, []);

	return (
		<div className="flex flex-col w-full gap-4 p-1 overflow-y-auto">
			{/* Toolbar */}
			<div className="flex items-center w-full gap-4">
				<Filter />
				<div className="flex items-center gap-2 shrink-0">
					{hasControllers && allSystems.length > 0 && (
						<ComboDropdown
							title={getMessage().AGENTS_FILTER_SYSTEM}
							options={allSystems.map((s) => ({
								value: s,
								label:
									s === "kubernetes"
										? getMessage().AGENTS_SYSTEM_KUBERNETES
										: s === "docker"
											? getMessage().AGENTS_SYSTEM_DOCKER
											: getMessage().AGENTS_SYSTEM_LINUX,
							}))}
							selectedValues={systemFilter}
							type="system"
							updateSelectedValues={updateFilterValues}
							clearItem={clearFilterItem}
						/>
					)}
					{hasControllers && allProviders.length > 0 && (
						<ComboDropdown
							title={getMessage().AGENTS_FILTER_PROVIDER}
							options={allProviders.map((p) => ({
								value: p,
								label: p,
							}))}
							selectedValues={providerFilter}
							type="provider"
							updateSelectedValues={updateFilterValues}
							clearItem={clearFilterItem}
						/>
					)}
					{(hasControllers || serviceRows.length > 0 || codingRowsState.length > 0) && (
						<ComboDropdown
							title={getMessage().AGENTS_FILTER_STATUS}
							options={[
								{
									value: "discovered",
									label: getMessage().AGENTS_FILTER_STATUS_DISCOVERED,
								},
								{
									value: "instrumented",
									label: getMessage().AGENTS_FILTER_STATUS_INSTRUMENTED,
								},
								{
									value: "sdk",
									label: getMessage().AGENTS_FILTER_STATUS_SDK,
								},
							]}
							selectedValues={statusFilter}
							type="status"
							updateSelectedValues={updateFilterValues}
							clearItem={clearFilterItem}
						/>
					)}
					<button
						onClick={refresh}
						disabled={isLoading}
						className="flex items-center justify-center w-[30px] h-[30px] border border-stone-200 dark:border-stone-800 rounded-md text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors disabled:opacity-50"
					>
						<RefreshCw
							className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
						/>
					</button>
				</div>
			</div>

			{refreshError && (
				<div className="px-4 py-2 rounded-md bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
					Failed to refresh: {refreshError}
				</div>
			)}

			{/*
			 * Empty-state gate. Coding-agent rows live in `codingRowsState`
			 * (fetched separately via ?source=coding) so they would NOT
			 * count toward `serviceRows.length`. Without checking them
			 * here, a user whose only telemetry is coding-agent activity
			 * would land on "No controllers detected" — exactly the bug
			 * Ishan hit. Adding `codingRowsState.length` keeps the
			 * Coding Agents tab reachable for coding-only users.
			 */}
			{!hasControllers &&
			serviceRows.length === 0 &&
			codingRowsState.length === 0 &&
			!isLoading ? (
				<NoController />
			) : (
				<>
					{/* Stat cards */}
					<div className="grid grid-cols-3 gap-4">
						<button
							onClick={() => handleStatClick("controllers")}
							className="border dark:border-stone-800 rounded-lg p-4 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
						>
							<div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
								{activeControllers.length}
								{staleCount > 0 && (
									<span className="text-sm font-normal text-stone-400 dark:text-stone-500 ml-1.5">
										({staleCount} stale)
									</span>
								)}
							</div>
							<div className="text-sm text-stone-500 dark:text-stone-400">
								{getMessage().AGENTS_STAT_CONTROLLERS}
							</div>
						</button>
						<button
							onClick={() => handleStatClick("discovered")}
							className="border dark:border-stone-800 rounded-lg p-4 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
						>
							<div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
								{totalServices}
							</div>
							<div className="text-sm text-stone-500 dark:text-stone-400">
								{getMessage().AGENTS_STAT_DISCOVERED_SERVICES}
							</div>
						</button>
						<button
							onClick={() => handleStatClick("instrumented")}
							className="border dark:border-stone-800 rounded-lg p-4 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
						>
							<div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
								{instrumentedServices}
							</div>
							<div className="text-sm text-stone-500 dark:text-stone-400">
								{getMessage().AGENTS_STAT_INSTRUMENTED_SERVICES}
							</div>
						</button>
					</div>

					{/* Tab switcher */}
					<div className="flex items-center border-b border-stone-200 dark:border-stone-700">
						{(
							[
								{ id: "services", label: getMessage().AGENTS_TAB_SERVICES },
								{ id: "controllers", label: getMessage().AGENTS_TAB_CONTROLLERS },
								{ id: "coding", label: getMessage().AGENTS_TAB_CODING, count: codingRows.length },
							] as const
						).map((tab) => (
							<button
								key={tab.id}
								onClick={() => {
									setActiveTab(tab.id);
								}}
								className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 inline-flex items-center gap-1.5 ${
									activeTab === tab.id
										? "border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100"
										: "border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300"
								}`}
							>
								{tab.label}
								{"count" in tab && tab.count > 0 ? (
									<span
										className={`text-[10px] leading-none px-1.5 py-0.5 rounded-full font-medium ${
											activeTab === tab.id
												? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
												: "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
										}`}
									>
										{tab.count}
									</span>
								) : null}
							</button>
						))}
						{activeTab === "controllers" && (
							<Button
								variant="outline"
								size="default"
								className="ml-auto text-xs h-auto py-1.5 px-3"
								onClick={() => setShowSetupModal(true)}
							>
								<Plus className="w-3 h-3 mr-1.5" />
								{getMessage().AGENTS_ADD_CONTROLLER}
							</Button>
						)}
					</div>

					{/* Content */}
					{activeTab === "services" && (
						<>
							<ServiceTable
								services={applicationRows}
								instances={controllerRows}
								onRefresh={refresh}
								isFetched={servicesFetched && instancesFetched}
								isLoading={isLoading}
								systemFilter={systemFilter}
							/>
							{nextCursor && (
								<div className="flex justify-center pt-2">
									<button
										onClick={loadMore}
										disabled={isLoadingMore}
										className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors disabled:opacity-50"
									>
										{isLoadingMore && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
										{isLoadingMore
											? getMessage().AGENTS_LOAD_MORE_LOADING
											: getMessage().AGENTS_LOAD_MORE}
									</button>
								</div>
							)}
						</>
					)}

					{activeTab === "controllers" && (
						<ControllerTable
							instances={controllerRows}
							isFetched={instancesFetched}
							isLoading={instancesLoading}
						/>
					)}

					{activeTab === "coding" && (
						<CodingAgentsTable
							services={codingRows}
							isFetched={servicesFetched}
							isLoading={isLoading}
						/>
					)}
				</>
			)}

			<Dialog open={showSetupModal} onOpenChange={setShowSetupModal}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>{getMessage().AGENTS_ADD_CONTROLLER}</DialogTitle>
						<DialogDescription>
							{getMessage().AGENTS_NO_CONTROLLERS_DESCRIPTION}
						</DialogDescription>
					</DialogHeader>
					<NoController inModal />
				</DialogContent>
			</Dialog>
		</div>
	);
}
