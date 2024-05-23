import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	getFilterConfig,
	getFilterDetails,
	getUpdateConfig,
	getUpdateFilter,
} from "@/selectors/filter";
import { useRootStore } from "@/store";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import ComboDropdown from "./combo-dropdown";
import { getPingStatus } from "@/selectors/database-config";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterConfig, FilterType } from "@/store/filter";
import SlideWithValue from "./slider-with-value";
import Sorting from "./sorting";

const TIME_RANGE_TYPE: Record<"24H" | "7D" | "1M" | "3M" | "CUSTOM", string> = {
	"24H": "24H",
	"7D": "7D",
	"1M": "1M",
	"3M": "3M",
	CUSTOM: "CUSTOM",
};

const TIME_RANGE_TABS: { key: string; label: string }[] = Object.keys(
	TIME_RANGE_TYPE
).map((k: string) => ({
	key: k,
	label: TIME_RANGE_TYPE[k as keyof typeof TIME_RANGE_TYPE],
}));

const DynamicFilters = ({
	isVisibleFilters,
	filter,
}: {
	isVisibleFilters: boolean;
	filter: FilterType;
}) => {
	const filterConfig = useRootStore(getFilterConfig);
	const pingStatus = useRootStore(getPingStatus);
	const filterDetails = useRootStore(getFilterDetails);
	const updateConfig = useRootStore(getUpdateConfig);
	const { fireRequest } = useFetchWrapper();
	const updateFilter = useRootStore(getUpdateFilter);
	const [selectedFilterValues, setSelectedFilterValues] = useState<
		Partial<FilterConfig>
	>(filterDetails.selectedConfig || {});

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
		updateFilter("selectedConfig", selectedFilterValues);
	};

	return (
		<div
			className={`flex w-full overflow-hidden transition-all ${
				isVisibleFilters ? "h-auto mt-4" : "h-0 mt-0"
			}`}
		>
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
					options={filterConfig?.providers.map((p) => ({ label: p, value: p }))}
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
			<div className="grow" />
			<Button
				variant="outline"
				size="default"
				className="text-stone-600 hover:text-stone-100 dark:text-stone-300 bg-stone-200 dark:bg-stone-700 hover:bg-stone-600 dark:hover:bg-primary border-none relative ml-4"
				onClick={updateFilterStore}
			>
				Apply Filters
			</Button>
		</div>
	);
};

const Filter = ({
	children = null,
	showDynamicFilters,
}: {
	children?: ReactNode;
	showDynamicFilters?: boolean;
}) => {
	const [isVisibleFilters, setIsVisibileFilters] = useState<boolean>(false);
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);

	const handleChange = (key: string) => {
		updateFilter("timeLimit.type", key);
	};

	const onCustomDateChange = (start: Date, end: Date) => {
		updateFilter("timeLimit.type", TIME_RANGE_TYPE.CUSTOM, { start, end });
	};

	const toggleIsVisibleFilters = () => setIsVisibileFilters((e) => !e);

	return (
		<div className="flex flex-col w-full mb-4 md:mb-4">
			<div className="flex w-full">
				<Tabs defaultValue={filter.timeLimit.type} onValueChange={handleChange}>
					<TabsList>
						{TIME_RANGE_TABS.map(({ label, key }) => (
							<TabsTrigger key={key} value={key}>
								{label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
				{filter.timeLimit.type === "CUSTOM" && (
					<DatePickerWithRange
						selectedDate={filter.timeLimit}
						onCustomDateChange={onCustomDateChange}
					/>
				)}
				<div className="grow" />
				{children}
				{showDynamicFilters && (
					<>
						<Sorting sorting={filter.sorting} />
						<Button
							variant="outline"
							size="default"
							className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 dark:bg-stone-800 dark:hover:bg-stone-900 aspect-square p-2.5 relative ml-4"
							onClick={toggleIsVisibleFilters}
						>
							<SlidersHorizontal />
							{isVisibleFilters && (
								<span className="w-1 h-1 bg-primary absolute top-1 right-1 rounded-full" />
							)}
						</Button>
					</>
				)}
			</div>
			{showDynamicFilters && (
				<DynamicFilters isVisibleFilters={isVisibleFilters} filter={filter} />
			)}
		</div>
	);
};

export default Filter;
