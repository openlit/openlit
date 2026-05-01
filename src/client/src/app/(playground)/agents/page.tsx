"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { RefreshCw, Plus } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import { TIME_RANGE_TYPE } from "@/store/filter";
import type { ControllerInstance, ControllerService } from "@/types/controller";
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

type Tab = "services" | "controllers";

export default function AgentsPage() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const initialTab = searchParams.get("tab") === "controllers" ? "controllers" : "services";
	const [activeTab, setActiveTabState] = useState<Tab>(initialTab);
	const [showSetupModal, setShowSetupModal] = useState(false);
	const [serviceRows, setServiceRows] = useState<ControllerService[]>([]);
	const [controllerRows, setControllerRows] = useState<ControllerInstance[]>([]);

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
		const tab = searchParams.get("tab") === "controllers" ? "controllers" : "services";
		setActiveTabState(tab);
	}, [searchParams]);

	const pathname = usePathname();
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);
	const pingStatus = useRootStore(getPingStatus);

	const {
		fireRequest: fetchInstances,
		data: instances,
		isFetched: instancesFetched,
		isLoading: instancesLoading,
	} = useFetchWrapper<ControllerInstance[]>();
	const {
		fireRequest: fetchServices,
		data: services,
		isFetched: servicesFetched,
		isLoading: servicesLoading,
	} = useFetchWrapper<ControllerService[]>();

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
		fetchServices({
			requestType: "GET",
			url: "/api/controller/catalog",
			responseDataKey: "data",
			successCb: (data) => {
				setServiceRows(data || []);
			},
			failureCb: (err: any) => setRefreshError(String(err)),
		});
	}, [
		fetchInstances,
		fetchServices,
	]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		)
			refresh();
	}, [filter.timeLimit.start, filter.timeLimit.end, pingStatus]);

	useEffect(() => {
		if (!pathname.startsWith("/agents")) return;
		if (filter.timeLimit.type === TIME_RANGE_TYPE.CUSTOM) return;

		updateFilter("timeLimit.type", filter.timeLimit.type);
	}, [pathname, filter.timeLimit.type, updateFilter]);

	useEffect(() => {
		const hasActiveWork = serviceRows.some((service) => {
			if (
				service.pending_action_status === "pending" ||
				service.pending_action_status === "acknowledged"
			)
				return true;
			const attrs = service.resource_attributes || {};
			const actualAgent = attrs["openlit.agent_observability.status"] || "";
			const desiredAgent = service.desired_agent_status || "none";
			if (desiredAgent === "enabled" && actualAgent !== "enabled") return true;
			if (desiredAgent === "none" && actualAgent === "enabled") return true;
			return false;
		});
		if (!hasActiveWork) return;

		const interval = window.setInterval(() => {
			refresh();
		}, 2500);

		return () => window.clearInterval(interval);
	}, [serviceRows, refresh]);

	const isLoading = instancesLoading || servicesLoading;
	const hasControllers = controllerRows.length > 0;

	const activeControllers = controllerRows.filter(
		(c) => (c.computed_status || c.status) !== "inactive"
	);
	const staleCount = controllerRows.length - activeControllers.length;
	const totalControllers = controllerRows.length;
	const totalServices = serviceRows.length;
	const instrumentedServices = serviceRows.filter(
		(s) =>
			s.instrumentation_status === "instrumented" ||
			s.desired_agent_status === "enabled"
	).length;

	const allProviders = useMemo(() => {
		const set = new Set<string>();
		for (const svc of serviceRows) {
			for (const p of svc.llm_providers || []) set.add(p);
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
					{hasControllers && (
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

			{!hasControllers && !isLoading ? (
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
							] as const
						).map((tab) => (
							<button
								key={tab.id}
								onClick={() => {
									setActiveTab(tab.id);
								}}
								className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
									activeTab === tab.id
										? "border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100"
										: "border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300"
								}`}
							>
								{tab.label}
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
						<ServiceTable
							services={serviceRows}
							instances={controllerRows}
							onRefresh={refresh}
							isFetched={servicesFetched && instancesFetched}
							isLoading={isLoading}
							statusFilter={statusFilter}
							systemFilter={systemFilter}
							providerFilter={providerFilter}
						/>
					)}

					{activeTab === "controllers" && (
						<ControllerTable
							instances={controllerRows}
							isFetched={instancesFetched}
							isLoading={instancesLoading}
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
