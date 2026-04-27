"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import { TIME_RANGE_TYPE } from "@/store/filter";
import type { ControllerInstance, ControllerService } from "@/types/controller";
import { Button } from "@/components/ui/button";
import Filter from "@/components/(playground)/filter";
import getMessage from "@/constants/messages";
import NoController from "./no-controller";
import ServiceTable from "./service-table";
import ControllerTable from "./controller-table";

type Tab = "services" | "controllers";

export default function AgentsPage() {
	const [activeTab, setActiveTab] = useState<Tab>("services");
	const [filtersVisible, setFiltersVisible] = useState(false);
	const [serviceRows, setServiceRows] = useState<ControllerService[]>([]);
	const [controllerRows, setControllerRows] = useState<ControllerInstance[]>([]);

	const [systemFilter, setSystemFilter] = useState<string>("");
	const [providerFilter, setProviderFilter] = useState<string>("");
	const [statusFilter, setStatusFilter] = useState<string>("");

	const [pendingSystem, setPendingSystem] = useState<string>("");
	const [pendingProvider, setPendingProvider] = useState<string>("");
	const [pendingStatus, setPendingStatus] = useState<string>("");

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
		fetchInstances({
			requestType: "GET",
			url: "/api/controller/instances",
			responseDataKey: "data",
			successCb: (data) => {
				setControllerRows(data || []);
			},
		});
		fetchServices({
			requestType: "GET",
			url: "/api/controller/catalog",
			responseDataKey: "data",
			successCb: (data) => {
				setServiceRows(data || []);
			},
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

	const filtersApplied = !!(systemFilter || providerFilter || statusFilter);

	const applyFilters = () => {
		setSystemFilter(pendingSystem);
		setProviderFilter(pendingProvider);
		setStatusFilter(pendingStatus);
	};

	const clearFilters = () => {
		setPendingSystem("");
		setPendingProvider("");
		setPendingStatus("");
		setSystemFilter("");
		setProviderFilter("");
		setStatusFilter("");
	};

	const handleStatClick = (stat: "controllers" | "discovered" | "instrumented") => {
		if (stat === "controllers") {
			setActiveTab("controllers");
		} else if (stat === "discovered") {
			setActiveTab("services");
			setStatusFilter("");
			setPendingStatus("");
		} else {
			setActiveTab("services");
			setStatusFilter("instrumented");
			setPendingStatus("instrumented");
		}
	};

	return (
		<div className="flex flex-col w-full gap-4 p-1 overflow-y-auto">
			{/* Toolbar */}
			<div className="flex flex-col w-full">
				<div className="flex items-center w-full gap-4">
					<Filter />
					<div className="flex items-center gap-2 shrink-0">
						<button
							onClick={refresh}
							disabled={isLoading}
							className="flex items-center justify-center w-[30px] h-[30px] border border-stone-200 dark:border-stone-800 rounded-md text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors disabled:opacity-50"
						>
							<RefreshCw
								className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
							/>
						</button>
						<Button
							variant="outline"
							size="default"
							className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 dark:bg-stone-800 dark:hover:bg-stone-900 aspect-square p-1 h-[30px] relative"
							onClick={() => setFiltersVisible((v) => !v)}
						>
							<SlidersHorizontal className="w-3 h-3" />
							{filtersApplied && (
								<span className="w-2 h-2 bg-primary absolute top-1 right-1 rounded-full animate-ping" />
							)}
						</Button>
					</div>
				</div>

				{/* Filter panel */}
				<div
					className={`flex w-full overflow-hidden transition-all gap-3 ${
						filtersVisible ? "h-auto mt-4" : "h-0 mt-0"
					}`}
				>
					<div className="flex grow gap-3 overflow-auto flex-wrap">
						{allSystems.length > 0 && (
							<FilterPill
								label={getMessage().AGENTS_FILTER_SYSTEM}
								value={pendingSystem}
							options={allSystems.map((s) => ({
								value: s,
								label: s === "kubernetes" ? getMessage().AGENTS_SYSTEM_KUBERNETES : s === "docker" ? getMessage().AGENTS_SYSTEM_DOCKER : getMessage().AGENTS_SYSTEM_LINUX,
							}))}
								onChange={setPendingSystem}
							/>
						)}
						{allProviders.length > 0 && (
							<FilterPill
								label={getMessage().AGENTS_FILTER_PROVIDER}
								value={pendingProvider}
								options={allProviders.map((p) => ({
									value: p,
									label: p,
								}))}
								onChange={setPendingProvider}
							/>
						)}
						<FilterPill
							label={getMessage().AGENTS_FILTER_STATUS}
							value={pendingStatus}
							options={[
								{ value: "discovered", label: getMessage().AGENTS_FILTER_STATUS_DISCOVERED },
								{ value: "instrumented", label: getMessage().AGENTS_FILTER_STATUS_INSTRUMENTED },
							]}
							onChange={setPendingStatus}
						/>
					</div>
					<div className="flex shrink-0 gap-3">
						{filtersApplied && (
							<Button
								variant="ghost"
								size="default"
								className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 py-1.5 px-2 relative h-auto text-xs"
								onClick={clearFilters}
							>
								{getMessage().AGENTS_CLEAR_FILTERS}
							</Button>
						)}
						<Button
							variant="outline"
							size="default"
							className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 dark:bg-stone-800 dark:hover:bg-stone-900 py-1.5 px-2 relative h-auto text-xs"
							onClick={applyFilters}
						>
							{getMessage().AGENTS_APPLY_FILTERS}
						</Button>
					</div>
				</div>
			</div>

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
								{totalControllers}
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
					<div className="flex border-b border-stone-200 dark:border-stone-700">
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
									if (tab.id === "services") {
										setStatusFilter("");
										setPendingStatus("");
									}
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
		</div>
	);
}

function FilterPill({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (v: string) => void;
}) {
	return (
		<select
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className={`text-xs border rounded-full px-3 py-1.5 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-stone-400 ${
				value
					? "border-stone-900 dark:border-stone-100 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900"
					: "border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800"
			}`}
		>
			<option value="">{label}</option>
			{options.map((opt) => (
				<option key={opt.value} value={opt.value}>
					{opt.label}
				</option>
			))}
		</select>
	);
}
