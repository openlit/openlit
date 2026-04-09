"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import type { CollectorInstance, CollectorService } from "@/types/collector";
import { Button } from "@/components/ui/button";
import Filter from "@/components/(playground)/filter";
import NoCollector from "./no-collector";
import ServiceTable from "./service-table";
import CollectorTable from "./collector-table";

type Tab = "services" | "collectors";

export default function InstrumentationHub() {
	const [activeTab, setActiveTab] = useState<Tab>("services");
	const [filtersVisible, setFiltersVisible] = useState(false);

	const [systemFilter, setSystemFilter] = useState<string>("");
	const [providerFilter, setProviderFilter] = useState<string>("");
	const [statusFilter, setStatusFilter] = useState<string>("");

	const [pendingSystem, setPendingSystem] = useState<string>("");
	const [pendingProvider, setPendingProvider] = useState<string>("");
	const [pendingStatus, setPendingStatus] = useState<string>("");

	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);

	const {
		fireRequest: fetchInstances,
		data: instances,
		isFetched: instancesFetched,
		isLoading: instancesLoading,
	} = useFetchWrapper<CollectorInstance[]>();
	const {
		fireRequest: fetchServices,
		data: services,
		isFetched: servicesFetched,
		isLoading: servicesLoading,
	} = useFetchWrapper<CollectorService[]>();

	const refresh = useCallback(() => {
		fetchInstances({
			requestType: "GET",
			url: "/api/collector/instances",
			responseDataKey: "data",
		});
		const params = new URLSearchParams();
		if (filter.timeLimit.start)
			params.set(
				"start",
				new Date(filter.timeLimit.start)
					.toISOString()
					.replace("T", " ")
					.replace(/\.\d{3}Z$/, "")
			);
		if (filter.timeLimit.end)
			params.set(
				"end",
				new Date(filter.timeLimit.end)
					.toISOString()
					.replace("T", " ")
					.replace(/\.\d{3}Z$/, "")
			);
		fetchServices({
			requestType: "GET",
			url: `/api/collector/catalog?${params.toString()}`,
			responseDataKey: "data",
		});
	}, [fetchInstances, fetchServices, filter.timeLimit.start, filter.timeLimit.end]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		)
			refresh();
	}, [filter.timeLimit.start, filter.timeLimit.end, pingStatus]);

	const isLoading = instancesLoading || servicesLoading;
	const hasCollectors = instances && instances.length > 0;

	const totalCollectors = instances?.length || 0;
	const totalServices = services?.length || 0;
	const instrumentedServices =
		services?.filter((s) => s.instrumentation_status === "instrumented")
			.length || 0;

	const allProviders = useMemo(() => {
		const set = new Set<string>();
		for (const svc of services || []) {
			for (const p of svc.llm_providers || []) set.add(p);
		}
		return Array.from(set).sort();
	}, [services]);

	const allSystems = useMemo(() => {
		const set = new Set<string>();
		for (const inst of instances || []) {
			set.add(inst.mode === "kubernetes" ? "kubernetes" : inst.mode === "docker" ? "docker" : "linux");
		}
		return Array.from(set).sort();
	}, [instances]);

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

	const handleStatClick = (stat: "collectors" | "discovered" | "instrumented") => {
		if (stat === "collectors") {
			setActiveTab("collectors");
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
								label="System"
								value={pendingSystem}
							options={allSystems.map((s) => ({
								value: s,
								label: s === "kubernetes" ? "Kubernetes" : s === "docker" ? "Docker" : "Linux",
							}))}
								onChange={setPendingSystem}
							/>
						)}
						{allProviders.length > 0 && (
							<FilterPill
								label="Provider"
								value={pendingProvider}
								options={allProviders.map((p) => ({
									value: p,
									label: p,
								}))}
								onChange={setPendingProvider}
							/>
						)}
						<FilterPill
							label="Status"
							value={pendingStatus}
							options={[
								{ value: "discovered", label: "Discovered" },
								{ value: "instrumented", label: "Instrumented" },
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
								Clear Filters
							</Button>
						)}
						<Button
							variant="outline"
							size="default"
							className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 dark:bg-stone-800 dark:hover:bg-stone-900 py-1.5 px-2 relative h-auto text-xs"
							onClick={applyFilters}
						>
							Apply Filters
						</Button>
					</div>
				</div>
			</div>

			{!hasCollectors && !isLoading ? (
				<NoCollector />
			) : (
				<>
					{/* Stat cards */}
					<div className="grid grid-cols-3 gap-4">
						<button
							onClick={() => handleStatClick("collectors")}
							className="border dark:border-stone-700 rounded-lg p-4 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
						>
							<div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
								{totalCollectors}
							</div>
							<div className="text-sm text-stone-500 dark:text-stone-400">
								Collectors
							</div>
						</button>
						<button
							onClick={() => handleStatClick("discovered")}
							className="border dark:border-stone-700 rounded-lg p-4 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
						>
							<div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
								{totalServices}
							</div>
							<div className="text-sm text-stone-500 dark:text-stone-400">
								Discovered Services
							</div>
						</button>
						<button
							onClick={() => handleStatClick("instrumented")}
							className="border dark:border-stone-700 rounded-lg p-4 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
						>
							<div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
								{instrumentedServices}
							</div>
							<div className="text-sm text-stone-500 dark:text-stone-400">
								Instrumented Services
							</div>
						</button>
					</div>

					{/* Tab switcher */}
					<div className="flex border-b dark:border-stone-700">
						{(
							[
								{ id: "services", label: "Services" },
								{ id: "collectors", label: "Collectors" },
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
								{tab.id === "collectors" &&
									instances &&
									instances.length > 0 && (
										<span className="ml-2 text-xs bg-stone-200 dark:bg-stone-700 px-1.5 py-0.5 rounded-full">
											{instances.length}
										</span>
									)}
							</button>
						))}
					</div>

					{/* Content */}
					{activeTab === "services" && (
						<ServiceTable
							services={services || []}
							instances={instances || []}
							onRefresh={refresh}
							isFetched={servicesFetched && instancesFetched}
							isLoading={isLoading}
							statusFilter={statusFilter}
							systemFilter={systemFilter}
							providerFilter={providerFilter}
						/>
					)}

					{activeTab === "collectors" && (
						<CollectorTable
							instances={instances || []}
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
