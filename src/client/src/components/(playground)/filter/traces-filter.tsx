import TracesPagination from "@/components/(playground)/filter/traces-pagination";
import { ceil } from "lodash";
import Filter from ".";
import {
	getFilterConfig,
	getFilterDetails,
	getUpdateFilter,
	getUpdateConfig,
	getAttributeKeys,
	getUpdateAttributeKeys,
} from "@/selectors/filter";
import { useRootStore } from "@/store";
import Sorting from "./sorting";
import ComboDropdown from "./combo-dropdown";
import SlideWithValue from "./slider-with-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, SlidersHorizontal, Trash2, ChevronDown, Layers, Link2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { getPingStatus } from "@/selectors/database-config";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
	AttributeKeys,
	CustomFilter,
	CustomFilterAttributeType,
	FilterConfig,
	FilterSorting,
	FilterType,
	TIME_RANGES,
} from "@/types/store/filter";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import VisibilityColumns from "./visibility-columns";
import { PAGE } from "@/types/store/page";
import { Columns } from "@/components/data-table/columns";
import { useRouter, usePathname } from "next/navigation";

// ─── Combobox (text input + inline dropdown, portal-rendered to escape overflow) ───

const Combobox = ({
	value,
	onChange,
	options,
	placeholder,
	className,
}: {
	value: string;
	onChange: (val: string) => void;
	options: string[];
	placeholder?: string;
	className?: string;
}) => {
	const [open, setOpen] = useState(false);
	const [inputValue, setInputValue] = useState(value);
	const inputRef = useRef<HTMLInputElement>(null);
	const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

	useEffect(() => {
		setInputValue(value);
	}, [value]);

	const updateDropdownPos = () => {
		if (inputRef.current) {
			const rect = inputRef.current.getBoundingClientRect();
			setDropdownStyle({
				position: "fixed",
				top: rect.bottom + 2,
				left: rect.left,
				width: Math.max(rect.width, 224),
			});
		}
	};

	const filtered = inputValue
		? options.filter((o) => o.toLowerCase().includes(inputValue.toLowerCase()))
		: options;

	const commit = (val: string) => {
		onChange(val);
		setInputValue(val);
		setOpen(false);
	};

	return (
		<div className={`relative ${className ?? "w-44"}`}>
			<Input
				ref={inputRef}
				placeholder={placeholder ?? ""}
				value={inputValue}
				onChange={(e) => {
					setInputValue(e.target.value);
					onChange(e.target.value);
					if (!open) { updateDropdownPos(); setOpen(true); }
				}}
				onFocus={() => { updateDropdownPos(); setOpen(true); }}
				onBlur={() => setTimeout(() => setOpen(false), 120)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						const exact = filtered.find(
							(o) => o.toLowerCase() === inputValue.toLowerCase()
						);
						commit(exact ?? inputValue);
					} else if (e.key === "Escape") {
						setOpen(false);
					} else if (e.key === "ArrowDown" && open && filtered.length > 0) {
						e.preventDefault();
					}
				}}
				className={`h-7 text-xs w-full ${options.length > 0 ? "pr-6" : ""}`}
			/>
			{options.length > 0 && (
				<ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-stone-400 pointer-events-none" />
			)}
			{open && filtered.length > 0 && typeof window !== "undefined" && createPortal(
				<div
					style={dropdownStyle}
					className="z-[9999] rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 shadow-md max-h-48 overflow-auto"
				>
					{filtered.map((opt) => (
						<button
							key={opt}
							type="button"
							className="w-full text-left text-xs px-2 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"
							onMouseDown={(e) => {
								e.preventDefault();
								commit(opt);
							}}
						>
							{opt}
						</button>
					))}
				</div>,
				document.body
			)}
		</div>
	);
};

// ─── URL sync helpers ─────────────────────────────────────────────────────────

// Separator used inside a single custom-filter param value: type|key|value
const CF_SEP = "|";

function configToParams(config: Partial<FilterConfig>, params: URLSearchParams) {
	params.delete("models");
	params.delete("providers");
	params.delete("traceTypes");
	params.delete("appNames");
	params.delete("spanNames");
	params.delete("envs");
	params.delete("maxCost");
	// remove all existing cf entries
	params.delete("cf");

	if (config.models?.length) params.set("models", config.models.join(","));
	if (config.providers?.length) params.set("providers", config.providers.join(","));
	if (config.traceTypes?.length) params.set("traceTypes", config.traceTypes.join(","));
	if (config.applicationNames?.length) params.set("appNames", config.applicationNames.join(","));
	if (config.spanNames?.length) params.set("spanNames", config.spanNames.join(","));
	if (config.environments?.length) params.set("envs", config.environments.join(","));
	if (config.maxCost) params.set("maxCost", String(config.maxCost));
	config.customFilters?.forEach(({ attributeType, key, value }) => {
		if (key && value) {
			params.append("cf", [attributeType, key, value].join(CF_SEP));
		}
	});
}

function paramsToConfig(params: URLSearchParams): Partial<FilterConfig> {
	const config: Partial<FilterConfig> = {};
	const models = params.get("models");
	if (models) config.models = models.split(",").filter(Boolean);
	const providers = params.get("providers");
	if (providers) config.providers = providers.split(",").filter(Boolean);
	const traceTypes = params.get("traceTypes");
	if (traceTypes) config.traceTypes = traceTypes.split(",").filter(Boolean);
	const appNames = params.get("appNames");
	if (appNames) config.applicationNames = appNames.split(",").filter(Boolean);
	const spanNames = params.get("spanNames");
	if (spanNames) config.spanNames = spanNames.split(",").filter(Boolean);
	const envs = params.get("envs");
	if (envs) config.environments = envs.split(",").filter(Boolean);
	const maxCost = params.get("maxCost");
	if (maxCost) config.maxCost = parseFloat(maxCost);
	const cfValues = params.getAll("cf");
	if (cfValues.length) {
		config.customFilters = cfValues.map((raw) => {
			const [attributeType, key, ...rest] = raw.split(CF_SEP);
			return {
				attributeType: (attributeType || "SpanAttributes") as CustomFilterAttributeType,
				key: key || "",
				value: rest.join(CF_SEP),
			};
		}).filter((f) => f.key && f.value);
	}
	return config;
}

function hasActiveConfig(config: Partial<FilterConfig>): boolean {
	return Object.values(config).some((v) => {
		if (Array.isArray(v)) return v.length > 0;
		if (typeof v === "number") return v > 0;
		return !!v;
	});
}

// ─── DynamicFilters ───────────────────────────────────────────────────────────

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
	const attributeKeys = useRootStore(getAttributeKeys);
	const updateAttributeKeys = useRootStore(getUpdateAttributeKeys);
	const { fireRequest } = useFetchWrapper();
	const { fireRequest: fireAttrKeysRequest } = useFetchWrapper();
	const updateFilter = useRootStore(getUpdateFilter);
	const [selectedFilterValues, setSelectedFilterValues] = useState<
		Partial<FilterConfig>
	>(filterDetails.selectedConfig || {});
	const [customFilters, setCustomFilters] = useState<CustomFilter[]>(
		filterDetails.selectedConfig?.customFilters || []
	);

	// Keep local UI state in sync when the store's selectedConfig changes externally
	// (e.g. URL params applied on mount, or Clear Filters)
	useEffect(() => {
		setSelectedFilterValues(filterDetails.selectedConfig || {});
		setCustomFilters(filterDetails.selectedConfig?.customFilters || []);
	}, [filterDetails.selectedConfig]);

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
			case "spanNames":
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
				i === index
					? {
							...f,
							[field]: val as CustomFilterAttributeType,
							// Reset key when attribute type changes
							...(field === "attributeType" ? { key: "" } : {}),
					  }
					: f
			)
		);
	};

	const fetchConfig = useCallback(async (timeLimit: FilterType["timeLimit"]) => {
		fireRequest({
			body: JSON.stringify({ timeLimit }),
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
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Fetch filter config when time window changes or config is cleared after a range change.
	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success" &&
			!filterConfig
		) {
			fetchConfig(filter.timeLimit);
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filter.timeLimit.type, filter.timeLimit.start, filter.timeLimit.end, pingStatus, filterConfig]);

	const fetchAttributeKeys = useCallback(async (timeLimit: FilterType["timeLimit"]) => {
		fireAttrKeysRequest({
			body: JSON.stringify({ timeLimit }),
			requestType: "POST",
			url: "/api/metrics/request/attribute-keys",
			successCb: (resp) => {
				if (resp?.spanAttributeKeys !== undefined) {
					updateAttributeKeys({
						spanAttributeKeys: resp.spanAttributeKeys,
						resourceAttributeKeys: resp.resourceAttributeKeys,
					} as AttributeKeys);
				}
			},
			failureCb: () => {
				// silently fail – attribute keys are a nice-to-have
			},
		});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Fetch attribute keys whenever the time window changes.
	// Use leaf primitives as deps – lodash merge mutates timeLimit in-place
	// so the object reference never changes between renders.
	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		) {
			fetchAttributeKeys(filter.timeLimit);
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filter.timeLimit.type, filter.timeLimit.start, filter.timeLimit.end, pingStatus]);

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
					{filterConfig?.spanNames?.length ? (
						<ComboDropdown
							options={filterConfig?.spanNames.map((s) => ({
								label: s,
								value: s,
							}))}
							title="Span Names"
							type="spanNames"
							updateSelectedValues={updateSelectedValues}
							selectedValues={selectedFilterValues.spanNames}
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
					<div className="flex flex-wrap gap-2 max-h-[120px] overflow-auto">
						{customFilters.map((cf, index) => (
							<div key={index} className="flex items-center gap-1.5">
								<select
									value={cf.attributeType}
									onChange={(e) =>
										updateCustomFilter(index, "attributeType", e.target.value)
									}
									className="h-7 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 text-xs px-1.5 focus-visible:outline-none"
								>
									<option value="SpanAttributes">Span Attributes</option>
									<option value="ResourceAttributes">Resource Attributes</option>
									<option value="Field">Field</option>
								</select>

								{cf.attributeType === "Field" ? (
									<Input
										placeholder="e.g. SpanName"
										value={cf.key}
										onChange={(e) =>
											updateCustomFilter(index, "key", e.target.value)
										}
										className="h-7 text-xs w-44"
									/>
								) : (
									<Combobox
										value={cf.key}
										onChange={(val) => updateCustomFilter(index, "key", val)}
										options={
											cf.attributeType === "SpanAttributes"
												? (attributeKeys?.spanAttributeKeys ?? [])
												: (attributeKeys?.resourceAttributeKeys ?? [])
										}
										placeholder="e.g. gen_ai.system"
									/>
								)}

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

// ─── GroupBy selector ─────────────────────────────────────────────────────────

const GROUP_BY_OPTIONS: { key: string; label: string }[] = [
	{ key: "model", label: "Model" },
	{ key: "provider", label: "Provider" },
	{ key: "spanName", label: "Span Name" },
	{ key: "applicationName", label: "Application" },
];

const PREDEFINED_GROUP_BY_KEYS = new Set<string>(GROUP_BY_OPTIONS.map((o) => o.key));

function getGroupByDisplayLabel(groupBy: string | undefined): string | undefined {
	if (!groupBy) return undefined;
	const predefined = GROUP_BY_OPTIONS.find((o) => o.key === groupBy)?.label;
	if (predefined) return predefined;
	const sep = groupBy.indexOf(":");
	return sep !== -1 ? groupBy.slice(sep + 1) : groupBy;
}

// Simple inline suggest input — renders suggestions as a regular div child (no portal)
// so it doesn't conflict with the Popover's DismissableLayer.
function InlineSuggest({
	value,
	onChange,
	options,
	placeholder,
}: {
	value: string;
	onChange: (val: string) => void;
	options: string[];
	placeholder?: string;
}) {
	const [open, setOpen] = useState(false);
	const filtered = value
		? options.filter((o) => o.toLowerCase().includes(value.toLowerCase())).slice(0, 40)
		: options.slice(0, 40);

	return (
		<div className="relative">
			<Input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onFocus={() => setOpen(true)}
				onBlur={() => setTimeout(() => setOpen(false), 120)}
				placeholder={placeholder}
				className="h-7 text-xs"
			/>
			{open && filtered.length > 0 && (
				<div className="absolute top-full left-0 right-0 z-50 mt-0.5 max-h-40 overflow-auto rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 shadow-md">
					{filtered.map((opt) => (
						<button
							key={opt}
							type="button"
							className="w-full text-left text-xs px-2 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"
							onMouseDown={(e) => {
								e.preventDefault();
								onChange(opt);
								setOpen(false);
							}}
						>
							{opt}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function GroupByDropdown({
	groupBy,
	onChangeGroupBy,
}: {
	groupBy?: string;
	onChangeGroupBy: (key: string | undefined) => void;
}) {
	const attributeKeys = useRootStore(getAttributeKeys);
	const [open, setOpen] = useState(false);
	const [customAttrType, setCustomAttrType] = useState<CustomFilterAttributeType>("SpanAttributes");
	const [customKey, setCustomKey] = useState("");

	// When groupBy changes externally (e.g. from URL restore), pre-fill the custom form
	useEffect(() => {
		if (groupBy && !PREDEFINED_GROUP_BY_KEYS.has(groupBy)) {
			const sep = groupBy.indexOf(":");
			if (sep !== -1) {
				const attrType = groupBy.slice(0, sep) as CustomFilterAttributeType;
				const key = groupBy.slice(sep + 1);
				setCustomAttrType(attrType);
				setCustomKey(key);
			} else {
				setCustomKey(groupBy);
			}
		} else if (!groupBy) {
			setCustomKey("");
		}
	}, [groupBy]);

	const activeLabel = getGroupByDisplayLabel(groupBy);
	const isCustomActive = !!groupBy && !PREDEFINED_GROUP_BY_KEYS.has(groupBy);

	const customOptions =
		customAttrType === "SpanAttributes"
			? (attributeKeys?.spanAttributeKeys ?? [])
			: customAttrType === "ResourceAttributes"
			? (attributeKeys?.resourceAttributeKeys ?? [])
			: [];

	const applyCustom = () => {
		const k = customKey.trim();
		if (!k) return;
		onChangeGroupBy(`${customAttrType}:${k}`);
		setOpen(false);
	};

	const selectPredefined = (key: string | undefined) => {
		onChangeGroupBy(key);
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 dark:bg-stone-800 dark:hover:bg-stone-900 p-1 h-[30px] relative gap-1.5 text-xs aspect-square"
					variant="outline"
				>
					<Layers className="w-3 h-3 shrink-0" />
					{activeLabel ? <span className="max-w-[80px] truncate">{activeLabel}</span> : null}
					{groupBy && (
						<span className="w-2 h-2 bg-primary absolute -top-0 -right-0 rounded-full" />
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-64 p-1" align="end">
				{/* Predefined options */}
				<button
					className="flex w-full items-center px-2 py-1.5 text-xs rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"
					onClick={() => selectPredefined(undefined)}
				>
					None
					{!groupBy && <span className="ml-auto text-primary">✓</span>}
				</button>
				{GROUP_BY_OPTIONS.map(({ key, label }) => (
					<button
						key={key}
						className="flex w-full items-center px-2 py-1.5 text-xs rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"
						onClick={() => selectPredefined(key)}
					>
						{label}
						{groupBy === key && <span className="ml-auto text-primary">✓</span>}
					</button>
				))}

				{/* Custom attribute section */}
				<div className="border-t dark:border-stone-700 mt-1 pt-2 px-1 pb-1">
					<p className="text-xs text-stone-400 dark:text-stone-500 mb-1.5">
						Custom attribute
						{isCustomActive && <span className="ml-1.5 text-primary">✓</span>}
					</p>
					<div className="flex flex-col gap-1.5">
						<select
							value={customAttrType}
							onChange={(e) => {
								setCustomAttrType(e.target.value as CustomFilterAttributeType);
								setCustomKey("");
							}}
							className="h-7 w-full rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 text-xs px-1.5 focus-visible:outline-none"
						>
							<option value="SpanAttributes">Span Attributes</option>
							<option value="ResourceAttributes">Resource Attributes</option>
							<option value="Field">Field</option>
						</select>
						<InlineSuggest
							value={customKey}
							onChange={setCustomKey}
							options={customOptions}
							placeholder="e.g. gen_ai.request.user"
						/>
						<Button
							size="default"
							variant="outline"
							className="h-7 text-xs w-full"
							onClick={applyCustom}
						>
							Apply
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

// ─── Local storage persistence ────────────────────────────────────────────────

const FILTER_STORAGE_KEY = "openlit_filter_v1";

// Params that indicate a meaningful filter is present in the URL
const FILTER_PARAM_KEYS = ["tr", "ts", "te", "limit", "models", "providers", "traceTypes", "appNames", "spanNames", "envs", "maxCost", "cf", "gb", "gbv"];

type PersistedFilter = {
	timeLimitType: string;
	timeLimitStart?: string;
	timeLimitEnd?: string;
	limit: number;
	selectedConfig: Partial<FilterConfig>;
	sorting: FilterSorting;
	groupBy?: string;
	groupValue?: string;
};

function saveFilterToStorage(filter: FilterType) {
	try {
		const toSave: PersistedFilter = {
			timeLimitType: filter.timeLimit.type,
			timeLimitStart: filter.timeLimit.start
				? new Date(filter.timeLimit.start).toISOString()
				: undefined,
			timeLimitEnd: filter.timeLimit.end
				? new Date(filter.timeLimit.end).toISOString()
				: undefined,
			limit: filter.limit,
			selectedConfig: filter.selectedConfig,
			sorting: filter.sorting,
			groupBy: filter.groupBy,
			groupValue: filter.groupValue,
		};
		localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(toSave));
	} catch {}
}

function loadFilterFromStorage(): PersistedFilter | null {
	try {
		const raw = localStorage.getItem(FILTER_STORAGE_KEY);
		return raw ? (JSON.parse(raw) as PersistedFilter) : null;
	} catch {
		return null;
	}
}

function applyStoredFilter(
	saved: PersistedFilter,
	updateFilter: (key: string, value: any, extraParams?: any) => void,
	validTimeRanges: Set<string>
) {
	// Time limit first (it resets selectedConfig, so must come before selectedConfig)
	if (saved.timeLimitType === "CUSTOM" && saved.timeLimitStart && saved.timeLimitEnd) {
		updateFilter("timeLimit.type", "CUSTOM", {
			start: new Date(saved.timeLimitStart),
			end: new Date(saved.timeLimitEnd),
		});
	} else if (validTimeRanges.has(saved.timeLimitType)) {
		updateFilter("timeLimit.type", saved.timeLimitType as TIME_RANGES);
	}
	if (saved.limit) updateFilter("limit", saved.limit);
	if (saved.selectedConfig && hasActiveConfig(saved.selectedConfig)) {
		updateFilter("selectedConfig", saved.selectedConfig);
	}
	if (saved.sorting?.type) updateFilter("sorting", saved.sorting);
	if (saved.groupBy) updateFilter("groupBy", saved.groupBy);
	if (saved.groupValue) updateFilter("groupValue", saved.groupValue);
}

// ─── URL filter sync hook ─────────────────────────────────────────────────────

const VALID_TIME_RANGES = new Set(["24H", "7D", "1M", "3M", "CUSTOM"]);

function useFilterUrlSync(filter: FilterType, updateFilter: (key: string, value: any, extraParams?: any) => void) {
	const router = useRouter();
	const pathname = usePathname();
	// Tracks whether the initial URL read has been applied to the store
	const initializedFromUrl = useRef(false);

	// On mount: URL params take priority; fall back to localStorage if URL has none.
	useEffect(() => {
		if (initializedFromUrl.current) return;
		initializedFromUrl.current = true;

		const params = new URLSearchParams(window.location.search);
		const hasUrlParams = FILTER_PARAM_KEYS.some((k) => params.has(k));

		if (hasUrlParams) {
			// ── Apply URL params ──────────────────────────────────────────────
			const tr = params.get("tr");
			if (tr && VALID_TIME_RANGES.has(tr)) {
				if (tr === "CUSTOM") {
					const ts = params.get("ts");
					const te = params.get("te");
					if (ts && te) {
						updateFilter("timeLimit.type", "CUSTOM", {
							start: new Date(ts),
							end: new Date(te),
						});
					}
				} else {
					updateFilter("timeLimit.type", tr);
				}
			}
			const limitParam = params.get("limit");
			if (limitParam) {
				const parsed = parseInt(limitParam, 10);
				if (!isNaN(parsed) && parsed > 0) updateFilter("limit", parsed);
			}
			const config = paramsToConfig(params);
			if (hasActiveConfig(config)) updateFilter("selectedConfig", config);
			const gb = params.get("gb");
			if (gb) updateFilter("groupBy", gb);
			const gbv = params.get("gbv");
			if (gbv) updateFilter("groupValue", gbv);
		} else {
			// ── Fall back to localStorage ─────────────────────────────────────
			const saved = loadFilterFromStorage();
			if (saved) applyStoredFilter(saved, updateFilter, VALID_TIME_RANGES);
		}

		// Signal that the initial filter read (URL / localStorage) is complete.
		// Pages use this flag to avoid fetching before the correct params are applied.
		updateFilter("filterReady", true);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// When filter state changes: write all serialisable parts to the URL
	const prevSerializedRef = useRef<string>("");
	useEffect(() => {
		if (!initializedFromUrl.current) return;

		const params = new URLSearchParams(window.location.search);

		// Time limit
		params.set("tr", filter.timeLimit.type);
		if (filter.timeLimit.type === "CUSTOM") {
			if (filter.timeLimit.start)
				params.set("ts", new Date(filter.timeLimit.start).toISOString());
			if (filter.timeLimit.end)
				params.set("te", new Date(filter.timeLimit.end).toISOString());
		} else {
			params.delete("ts");
			params.delete("te");
		}

		// Page size
		params.set("limit", String(filter.limit));

		// Selected config
		configToParams(filter.selectedConfig, params);

		// Group by
		if (filter.groupBy) params.set("gb", filter.groupBy);
		else params.delete("gb");

		// Group value
		if (filter.groupValue) params.set("gbv", filter.groupValue);
		else params.delete("gbv");

		const qs = params.toString();
		if (qs !== prevSerializedRef.current) {
			prevSerializedRef.current = qs;
			router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
		}

		// Persist to localStorage so other pages (and refreshes) pick up these filters
		saveFilterToStorage(filter);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filter.timeLimit.type, filter.timeLimit.start, filter.timeLimit.end, filter.limit, filter.selectedConfig, filter.groupBy, filter.groupValue]);
}

// ─── TracesFilter (exported) ──────────────────────────────────────────────────

export default function TracesFilter({
	total,
	supportDynamicFilters = false,
	includeOnlySorting,
	pageName,
	columns,
}: {
	total?: number;
	supportDynamicFilters?: boolean;
	includeOnlySorting?: string[];
	pageName: PAGE;
	columns: Columns<any, any>;
}) {
	const [isVisibleFilters, setIsVisibileFilters] = useState<boolean>(false);
	const filter = useRootStore(getFilterDetails);
	const filterConfig = useRootStore(getFilterConfig);
	const updateFilter = useRootStore(getUpdateFilter);

	const onChangeGroupBy = (key: string | undefined) => {
		updateFilter("groupBy", key ?? null);
	};

	const onShareLink = () => {
		if (typeof window === "undefined") return;

		const clipboard = navigator.clipboard;
		if (!clipboard?.writeText) {
			toast.error("Copy to clipboard is not supported in this browser");
			return;
		}

		clipboard
			.writeText(window.location.href)
			.then(() => {
				toast.success("Link copied to clipboard");
			})
			.catch(() => {
				toast.error("Could not copy link");
			});
	};

	useFilterUrlSync(filter, updateFilter);

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
				{filterConfig && !!total && total > 0 && (
					<TracesPagination
						currentPage={filter.offset / filter.limit + 1}
						currentSize={filter.limit}
						totalPage={ceil(total / filter.limit)}
						onClickPageAction={onClickPageAction}
						onClickPageLimit={onClickPageLimit}
					/>
				)}
				<VisibilityColumns columns={columns} pageName={pageName} />
				{!!total && total > 0 && (
					<Sorting
						sorting={filter.sorting}
						includeOnlySorting={includeOnlySorting}
					/>
				)}
				{supportDynamicFilters && (
					<GroupByDropdown
						groupBy={filter.groupBy}
						onChangeGroupBy={onChangeGroupBy}
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
							<span className="w-2 h-2 bg-primary absolute top-1 right-1 rounded-full animate-ping" />
						)}
					</Button>
				)}
				<Button
					variant="outline"
					size="default"
					title="Copy shareable link"
					className="text-stone-500 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300 dark:bg-stone-800 dark:hover:bg-stone-900 aspect-square p-1 h-[30px]"
					onClick={onShareLink}
				>
					<Link2 className="w-3 h-3" />
				</Button>
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
