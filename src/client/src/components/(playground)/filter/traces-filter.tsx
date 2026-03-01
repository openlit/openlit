import TracesPagination from "@/components/(playground)/filter/traces-pagination";
import { ceil } from "lodash";
import Filter from ".";
import {
	getFilterConfig,
	getFilterDetails,
	getUpdateFilter,
	getUpdateConfig,
} from "@/selectors/filter";
import { useRootStore } from "@/store";
import Sorting from "./sorting";
import ComboDropdown from "./combo-dropdown";
import SlideWithValue from "./slider-with-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";

import { getPingStatus } from "@/selectors/database-config";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	CustomFilter,
	CustomFilterAttributeType,
	FilterConfig,
	FilterType,
} from "@/types/store/filter";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import VisibilityColumns from "./visibility-columns";
import { PAGE } from "@/types/store/page";
import { Columns } from "@/components/data-table/columns";

const DynamicFilters = ({
	isVisibleFilters,
	filter,
	areFiltersApplied,
}: {
	isVisibleFilters: boolean;
	filter: FilterType;
	areFiltersApplied: boolean;
}) => {
	const posthog = usePostHog();
	const filterConfig = useRootStore(getFilterConfig);
	const pingStatus = useRootStore(getPingStatus);
	const filterDetails = useRootStore(getFilterDetails);
	const updateConfig = useRootStore(getUpdateConfig);
	const { fireRequest } = useFetchWrapper();
	const updateFilter = useRootStore(getUpdateFilter);
	const [selectedFilterValues, setSelectedFilterValues] = useState<
		Partial<FilterConfig>
	>(filterDetails.selectedConfig || {});
	const [customFilters, setCustomFilters] = useState<CustomFilter[]>(
		filterDetails.selectedConfig?.customFilters || []
	);

	const clearFilter = (type: keyof FilterConfig) => {
		setSelectedFilterValues((e) => ({ ...e, [type]: undefined }));
	};

	const updateSelectedValues = (
		type: keyof FilterConfig,
		value: any,
		operationType?: "add" | "delete"
	) => {
		switch (type) {
			case "models":
			case "providers":
			case "traceTypes":
			case "applicationNames":
			case "environments":
				if (operationType === "add") {
					setSelectedFilterValues((s) => {
						const typeArray = s[type] || [];
						typeArray.push(value);
						return { ...s, [type]: typeArray };
					});
				} else if (operationType === "delete") {
					setSelectedFilterValues((s) => {
						const typeArray = s[type] || [];
						return { ...s, [type]: typeArray.filter((o) => o !== value) };
					});
				}
				break;
			case "maxCost":
				setSelectedFilterValues((s) => {
					return { ...s, [type]: value };
				});
		}
	};

	const addCustomFilter = () => {
		setCustomFilters((prev) => [
			...prev,
			{ attributeType: "SpanAttributes", key: "", value: "" },
		]);
	};

	const removeCustomFilter = (index: number) => {
		setCustomFilters((prev) => prev.filter((_, i) => i !== index));
	};

	const updateCustomFilter = (
		index: number,
		field: "attributeType" | "key" | "value",
		val: string
	) => {
		setCustomFilters((prev) =>
			prev.map((f, i) =>
				i === index ? { ...f, [field]: val as CustomFilterAttributeType } : f
			)
		);
	};

	const fetchConfig = useCallback(async () => {
		fireRequest({
			body: JSON.stringify({
				timeLimit: filter.timeLimit,
			}),
			requestType: "POST",
			url: "/api/metrics/request/config",
			successCb: (resp) => {
				updateConfig(resp.data?.[0]);
			},
			failureCb: (err?: string) => {
				toast.error(err || `Cannot fetch config!`, {
					id: "request-config",
				});
			},
		});
	}, [filter]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success" &&
			!filterConfig
		) {
			fetchConfig();
		}
	}, [filter, pingStatus, filterConfig, fetchConfig]);

	const updateFilterStore = () => {
		const validCustomFilters = customFilters.filter((f) => f.key && f.value);
		updateFilter("selectedConfig", {
			...selectedFilterValues,
			customFilters:
				validCustomFilters.length > 0 ? validCustomFilters : undefined,
		});
		posthog?.capture(CLIENT_EVENTS.TRACE_FILTER_APPLIED);
	};

	const clearFilterStore = () => {
		setSelectedFilterValues({});
		setCustomFilters([]);
		posthog?.capture(CLIENT_EVENTS.TRACE_FILTER_CLEARED);
		updateFilter("selectedConfig", {}, { clearFilter: true });
	};

	return (
		<div
			className={`flex flex-col w-full overflow-hidden transition-all gap-3 ${
				isVisibleFilters ? "h-auto mt-4" : "h-0 mt-0"
			}`}
		>
			{/* Predefined filter dropdowns + action buttons */}
			<div className="flex w-full gap-4 items-start">
				<div className="flex grow gap-3 overflow-auto flex-wrap">
					{filterConfig?.traceTypes?.length ? (
						<ComboDropdown
							options={filterConfig?.traceTypes.map((p) => ({
								label: p,
								value: p,
							}))}
							title="Types"
							type="traceTypes"
							updateSelectedValues={updateSelectedValues}
							selectedValues={selectedFilterValues.traceTypes}
							clearItem={clearFilter}
						/>
					) : null}
					{filterConfig?.models?.length ? (
						<ComboDropdown
							options={filterConfig?.models.map((m) => ({ label: m, value: m }))}
							title="Models"
							type="models"
							updateSelectedValues={updateSelectedValues}
							selectedValues={selectedFilterValues.models}
							clearItem={clearFilter}
						/>
					) : null}
					{filterConfig?.providers?.length ? (
						<ComboDropdown
							options={filterConfig?.providers.map((p) => ({
								label: p,
								value: p,
							}))}
							title="Providers"
							type="providers"
							updateSelectedValues={updateSelectedValues}
							selectedValues={selectedFilterValues.providers}
							clearItem={clearFilter}
						/>
					) : null}
					{filterConfig?.maxCost ? (
						<SlideWithValue
							label="Max Cost"
							value={selectedFilterValues.maxCost || 0}
							maxValue={filterConfig.maxCost}
							onChange={updateSelectedValues}
							type="maxCost"
						/>
					) : null}
					{filterConfig?.applicationNames?.length ? (
						<ComboDropdown
							options={filterConfig?.applicationNames.map((a) => ({
								label: a,
								value: a,
							}))}
							title="Application Names"
							type="applicationNames"
							updateSelectedValues={updateSelectedValues}
							selectedValues={selectedFilterValues.applicationNames}
							clearItem={clearFilter}
						/>
					) : null}
					{filterConfig?.environments?.length ? (
						<ComboDropdown
							options={filterConfig?.environments.map((e) => ({
								label: e,
								value: e,
							}))}
							title="Environments"
							type="environments"
							updateSelectedValues={updateSelectedValues}
							selectedValues={selectedFilterValues.environments}
							clearItem={clearFilter}
						/>
					) : null}
				</div>
				<div className="flex shrink-0 gap-3">
					{areFiltersApplied && (
						<Button
							variant="ghost"
							size="default"
							className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 py-1.5 px-2 relative h-auto text-xs"
							onClick={clearFilterStore}
						>
							Clear Filters
						</Button>
					)}
					<Button
						variant="outline"
						size="default"
						className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 dark:bg-stone-800 dark:hover:bg-stone-900 py-1.5 px-2 relative h-auto text-xs"
						onClick={updateFilterStore}
					>
						Apply Filters
					</Button>
				</div>
			</div>

			{/* Custom attribute key-value filters */}
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-3">
					<span className="text-xs text-stone-500 dark:text-stone-400 shrink-0">
						Custom Attributes
					</span>
					<Button
						variant="ghost"
						size="default"
						className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 py-1 px-2 h-auto text-xs gap-1"
						onClick={addCustomFilter}
					>
						<Plus className="w-3 h-3" />
						Add
					</Button>
				</div>
				{customFilters.length > 0 && (
					<div className="flex flex-wrap gap-2 max-h-[80px] overflow-auto">
						{customFilters.map((cf, index) => (
							<div key={index} className="flex items-center gap-1.5">
								<select
									value={cf.attributeType}
									onChange={(e) =>
										updateCustomFilter(index, "attributeType", e.target.value)
									}
									className="h-7 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 text-xs px-1.5 focus-visible:outline-none"
								>
									<option value="SpanAttributes">Span Attr</option>
									<option value="ResourceAttributes">Resource Attr</option>
									<option value="Field">Field</option>
								</select>
								<Input
									placeholder={
										cf.attributeType === "Field"
											? "e.g. SpanName"
											: "e.g. gen_ai.system"
									}
									value={cf.key}
									onChange={(e) =>
										updateCustomFilter(index, "key", e.target.value)
									}
									className="h-7 text-xs w-44"
								/>
								<Input
									placeholder="Value"
									value={cf.value}
									onChange={(e) =>
										updateCustomFilter(index, "value", e.target.value)
									}
									className="h-7 text-xs w-32"
								/>
								<Button
									variant="ghost"
									size="default"
									className="h-7 w-7 p-0 shrink-0 text-stone-400 hover:text-red-500"
									onClick={() => removeCustomFilter(index)}
								>
									<Trash2 className="w-3.5 h-3.5" />
								</Button>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
};

export default function TracesFilter({
	total,
	supportDynamicFilters = false,
	includeOnlySorting,
	pageName,
	columns,
}: {
	total: number;
	supportDynamicFilters?: boolean;
	includeOnlySorting?: string[];
	pageName: PAGE;
	columns: Columns<any, any>;
}) {
	const [isVisibleFilters, setIsVisibileFilters] = useState<boolean>(false);
	const filter = useRootStore(getFilterDetails);
	const filterConfig = useRootStore(getFilterConfig);
	const updateFilter = useRootStore(getUpdateFilter);
	const onClickPageAction = (dir: -1 | 1) => {
		updateFilter("offset", filter.offset + dir * filter.limit);
	};

	const onClickPageLimit = (size: number) => {
		updateFilter("limit", size);
	};

	const toggleIsVisibleFilters = () => setIsVisibileFilters((e) => !e);

	const areFiltersApplied =
		Object.keys(filter.selectedConfig).filter((k) => {
			const key = k as keyof FilterConfig;
			if (key === "customFilters") {
				return (
					(
						filter.selectedConfig.customFilters?.filter(
							(f) => f.key && f.value
						) || []
					).length > 0
				);
			}
			if (typeof filter.selectedConfig[key] === "number") {
				return (filter.selectedConfig[key] as number) > 0;
			} else if (
				typeof filter.selectedConfig[key] === "object" &&
				(filter.selectedConfig[key] as string[]).length
			) {
				return true;
			}
			return false;
		}).length > 0;

	useEffect(() => {
		return () => {
			updateFilter("page-change", "");
		};
	}, []);

	return (
		<div className="flex flex-col items-center w-full justify-between mb-4">
			<div className="flex w-full gap-4">
				<Filter />
				{filterConfig && total > 0 && (
					<TracesPagination
						currentPage={filter.offset / filter.limit + 1}
						currentSize={filter.limit}
						totalPage={ceil((total || 0) / filter.limit)}
						onClickPageAction={onClickPageAction}
						onClickPageLimit={onClickPageLimit}
					/>
				)}
				<VisibilityColumns columns={columns} pageName={pageName} />
				{total > 0 && (
					<Sorting
						sorting={filter.sorting}
						includeOnlySorting={includeOnlySorting}
					/>
				)}
				{supportDynamicFilters && (
					<Button
						variant="outline"
						size="default"
						className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 dark:bg-stone-800 dark:hover:bg-stone-900 aspect-square p-1 h-[30px] relative"
						onClick={toggleIsVisibleFilters}
					>
						<SlidersHorizontal className="w-3 h-3" />
						{areFiltersApplied && (
							<span className="w-1 h-1 bg-primary absolute top-1 right-1 rounded-full" />
						)}
					</Button>
				)}
			</div>
			{supportDynamicFilters && (
				<DynamicFilters
					isVisibleFilters={isVisibleFilters}
					filter={filter}
					areFiltersApplied={areFiltersApplied}
				/>
			)}
		</div>
	);
}
