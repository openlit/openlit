"use client";

/**
 * Structured-query builder for external (non-SQL) telemetry sources.
 *
 * Built-in ClickHouse widgets use raw SQL; external sources speak their own
 * query language, so we collect a vendor-agnostic `OpenLITQuery` (minus its
 * time range, which the dashboard filter injects at run time) that
 * `executeStructuredWidgetQuery` dispatches by signal + mode. The output shape
 * matches `WidgetSourceConfig.structuredQuery`.
 */

import React, { useEffect, useId, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	WIDGET_STRUCTURED_ADD_AGGREGATION,
	WIDGET_STRUCTURED_ADD_FILTER,
	WIDGET_STRUCTURED_AGGREGATIONS_LABEL,
	WIDGET_STRUCTURED_AGGREGATION_UNSUPPORTED,
	WIDGET_STRUCTURED_ALIAS_PLACEHOLDER,
	WIDGET_STRUCTURED_BUILDER_TITLE,
	WIDGET_STRUCTURED_DURATION_PLACEHOLDER,
	WIDGET_STRUCTURED_FIELD_PLACEHOLDER,
	WIDGET_STRUCTURED_FILTERS_LABEL,
	WIDGET_STRUCTURED_FILTER_TARGET_LABEL,
	WIDGET_STRUCTURED_GROUP_BY_LABEL,
	WIDGET_STRUCTURED_GROUP_BY_PLACEHOLDER,
	WIDGET_STRUCTURED_INTERVAL_LABEL,
	WIDGET_STRUCTURED_KEY_PLACEHOLDER,
	WIDGET_STRUCTURED_LIMIT_LABEL,
	WIDGET_STRUCTURED_MODE_AGGREGATE,
	WIDGET_STRUCTURED_MODE_LABEL,
	WIDGET_STRUCTURED_MODE_LIST,
	WIDGET_STRUCTURED_MODE_TIMESERIES,
	WIDGET_STRUCTURED_PREVIOUS_PERIOD_LABEL,
	WIDGET_STRUCTURED_SIGNAL_LABEL,
	WIDGET_STRUCTURED_SORT_ASC,
	WIDGET_STRUCTURED_SORT_DESC,
	WIDGET_STRUCTURED_SORT_FIELD_PLACEHOLDER,
	WIDGET_STRUCTURED_SORT_LABEL,
	WIDGET_STRUCTURED_SPAN_NAME_PLACEHOLDER,
	WIDGET_STRUCTURED_STATUS_PLACEHOLDER,
	WIDGET_STRUCTURED_VALUE_PLACEHOLDER,
} from "@/constants/messages/en";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";

type StructuredMode = "list" | "aggregate" | "timeseries";
type Signal = "traces" | "logs" | "metrics";
type FilterScope = "span" | "resource" | "log" | "metric";
type FilterTarget = "attribute" | "spanName" | "status" | "duration";
type FilterOp =
	| "exists"
	| "notExists"
	| "eq"
	| "neq"
	| "in"
	| "notIn"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "contains";
type AggregationFn =
	| "count"
	| "sum"
	| "avg"
	| "min"
	| "max"
	| "p50"
	| "p90"
	| "p95"
	| "p99"
	| "cardinality";
type SortDirection = "asc" | "desc";

interface FilterRow {
	target: FilterTarget;
	scope: FilterScope;
	key: string;
	op: FilterOp;
	value: string;
}

interface AggregationRow {
	fn: AggregationFn;
	field?: string;
	as?: string;
}

interface SortRow {
	field: string;
	direction: SortDirection;
}

export interface StructuredQueryValue {
	mode: StructuredMode;
	query: Record<string, any>;
}

interface Props {
	/** Signals the selected source is configured to serve. */
	signals: Signal[];
	/** True when the source can aggregate server-side (from source capabilities). */
	supportsAggregation?: boolean;
	value?: StructuredQueryValue;
	onChange: (value: StructuredQueryValue) => void;
	/**
	 * When true, the builder trusts the bound source's live metadata as the sole
	 * source of field/group-by options (Grafana getTagKeys pattern) and hides the
	 * built-in AI-attribute fallback list, so options always match what the
	 * source can actually serve. Defaults to false (built-in ClickHouse), which
	 * keeps the curated AI fallback keys for a good out-of-the-box experience.
	 */
	capabilityAware?: boolean;
	/**
	 * The widget's bound telemetry source id. Threaded into the metadata fetches
	 * so field/group-by options come from the source the widget actually queries,
	 * not the project's default traces routing.
	 */
	sourceId?: string;
}

const inputClass =
	"h-8 bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700 dark:text-white text-sm";
const triggerClass =
	"h-8 bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700 dark:text-white text-sm";
const contentClass =
	"bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700";

const DEFAULT_SIGNAL: Signal = "traces";

/**
 * Curated AI-relevant keys used ONLY as a fallback when the bound source has
 * not (yet) reported live attribute keys, so the dropdowns are never empty for
 * the built-in source. Capability-aware mode (external sources) suppresses
 * these in favor of the source's own reported keys.
 */
const FALLBACK_GROUP_BY_KEYS = [
	"service.name",
	"gen_ai.request.model",
	"gen_ai.system",
	"gen_ai.operation.name",
	"deployment.environment",
] as const;

const STATUS_CODE_OPTIONS = [
	"STATUS_CODE_OK",
	"STATUS_CODE_ERROR",
	"STATUS_CODE_UNSET",
	"Ok",
	"Error",
	"Unset",
] as const;

const FILTER_TARGETS: FilterTarget[] = [
	"attribute",
	"spanName",
	"status",
	"duration",
];

const OPS_BY_TARGET: Record<FilterTarget, FilterOp[]> = {
	attribute: [
		"eq",
		"neq",
		"in",
		"notIn",
		"contains",
		"exists",
		"notExists",
		"gt",
		"gte",
		"lt",
		"lte",
	],
	spanName: ["eq", "in", "contains"],
	status: ["eq", "in"],
	duration: ["gt", "gte", "lt", "lte", "eq"],
};

const AGG_FNS: AggregationFn[] = [
	"count",
	"sum",
	"avg",
	"min",
	"max",
	"p50",
	"p90",
	"p95",
	"p99",
	"cardinality",
];
const FILTER_SCOPES: FilterScope[] = ["span", "resource", "log", "metric"];
const FILTER_OPS: FilterOp[] = [
	"exists",
	"notExists",
	"eq",
	"neq",
	"in",
	"notIn",
	"gt",
	"gte",
	"lt",
	"lte",
	"contains",
];

function defaultOpForTarget(target: FilterTarget): FilterOp {
	return OPS_BY_TARGET[target][0];
}

function isListOp(op: FilterOp): boolean {
	return op === "in" || op === "notIn";
}

function isUnaryOp(op: FilterOp): boolean {
	return op === "exists" || op === "notExists";
}

function needsKey(target: FilterTarget): boolean {
	return target === "attribute";
}

function needsScope(target: FilterTarget): boolean {
	return target === "attribute";
}

function parseFilterValue(op: FilterOp, raw: string): string | string[] | number {
	if (isListOp(op)) {
		return raw
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
	}
	return raw;
}

function toFilterRows(filters: unknown): FilterRow[] {
	if (!Array.isArray(filters)) return [];
	return filters
		.filter((f) => {
			if (!f || typeof f !== "object") return false;
			const target = (f as any).target;
			return (
				target === "attribute" ||
				target === "spanName" ||
				target === "status" ||
				target === "duration"
			);
		})
		.map((f) => {
			const r = f as Record<string, any>;
			const target = (r.target as FilterTarget) || "attribute";
			const op = (r.op as FilterOp) || defaultOpForTarget(target);
			const value =
				typeof r.value === "number"
					? String(r.value)
					: Array.isArray(r.value)
						? r.value.join(", ")
						: String(r.value ?? "");
			return {
				target,
				scope: (r.scope as FilterScope) || "span",
				key: String(r.key || ""),
				op: FILTER_OPS.includes(op) ? op : defaultOpForTarget(target),
				value,
			};
		});
}

function toAggregationRows(aggregations: unknown): AggregationRow[] {
	if (!Array.isArray(aggregations)) return [];
	return aggregations.map((a) => {
		const r = a as Record<string, any>;
		return {
			fn: (r.fn as AggregationFn) || "count",
			field: r.field ? String(r.field) : undefined,
			as: r.as ? String(r.as) : undefined,
		};
	});
}

function toSortRow(sort: unknown): SortRow | null {
	if (!Array.isArray(sort) || !sort.length) return null;
	const first = sort[0];
	if (!first || typeof first !== "object") return null;
	const field = String((first as any).field || "").trim();
	if (!field) return null;
	const direction =
		(first as any).direction === "desc" ? "desc" : ("asc" as SortDirection);
	return { field, direction };
}

function filterIsComplete(f: FilterRow): boolean {
	if (needsKey(f.target) && !f.key.trim()) return false;
	if (isUnaryOp(f.op)) return true;
	if (f.target === "duration") {
		return Number.isFinite(Number(f.value.trim()));
	}
	return Boolean(f.value.trim());
}

function serializeFilter(f: FilterRow): Record<string, any> {
	const base: Record<string, any> = {
		target: f.target,
		op: f.op,
	};
	if (needsScope(f.target)) base.scope = f.scope;
	if (needsKey(f.target)) base.key = f.key.trim();

	if (isUnaryOp(f.op)) return base;

	if (f.target === "duration") {
		const n = Number(f.value.trim());
		base.value = Number.isFinite(n) ? n : f.value.trim();
		return base;
	}

	base.value = parseFilterValue(f.op, f.value);
	return base;
}

/** Serialize the builder rows back into an OpenLITQuery-shaped object. */
function buildQuery(
	signal: Signal,
	mode: StructuredMode,
	opts: {
		limit?: number;
		interval?: string;
		groupBy: string[];
		aggregations: AggregationRow[];
		filters: FilterRow[];
		sort: SortRow | null;
		includePrevious: boolean;
	}
): Record<string, any> {
	const filters = opts.filters.filter(filterIsComplete).map(serializeFilter);

	const query: Record<string, any> = { signal, aiSelector: signal === "traces" };
	if (filters.length) query.filters = filters;

	if (mode === "list") {
		query.limit = opts.limit && opts.limit > 0 ? opts.limit : 100;
	} else {
		const aggregations = (opts.aggregations.length
			? opts.aggregations
			: [{ fn: "count" as AggregationFn }]
		).map((a) => ({
			fn: a.fn,
			...(a.field ? { field: a.field } : {}),
			...(a.as ? { as: a.as } : {}),
		}));
		query.aggregations = aggregations;
		if (mode === "aggregate") {
			const groupBy = opts.groupBy.filter(Boolean);
			if (groupBy.length) query.groupBy = groupBy;
		}
		if (mode === "timeseries") {
			query.interval = opts.interval?.trim() || "1h";
		}
		if (opts.includePrevious) {
			query.includePrevious = true;
		}
		if (opts.sort?.field.trim()) {
			query.sort = [
				{
					field: opts.sort.field.trim(),
					direction: opts.sort.direction === "desc" ? "desc" : "asc",
				},
			];
		}
	}

	return query;
}

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
		a.localeCompare(b)
	);
}

function relativeLast24h() {
	const end = new Date();
	const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
	return {
		start: start.toISOString(),
		end: end.toISOString(),
		type: "relative" as const,
	};
}

export const StructuredQueryBuilder: React.FC<Props> = ({
	signals,
	supportsAggregation = true,
	value,
	onChange,
	capabilityAware = false,
	sourceId,
}) => {
	const query = (value?.query || {}) as Record<string, any>;
	const availableSignals = signals.length ? signals : [DEFAULT_SIGNAL];
	const signal = (query.signal as Signal) || availableSignals[0];
	const mode: StructuredMode = value?.mode || "timeseries";

	const groupBy: string[] = Array.isArray(query.groupBy)
		? query.groupBy.map(String)
		: [];
	const aggregations = toAggregationRows(query.aggregations);
	const filters = toFilterRows(query.filters);
	const limit = typeof query.limit === "number" ? query.limit : undefined;
	const interval = typeof query.interval === "string" ? query.interval : "";
	const sort = toSortRow(query.sort);
	const includePrevious = Boolean(query.includePrevious);

	const listId = useId();
	const attrKeysListId = `${listId}-attr-keys`;
	const groupByListId = `${listId}-group-by`;
	const spanNamesListId = `${listId}-span-names`;
	const statusListId = `${listId}-status`;
	const sortFieldListId = `${listId}-sort-field`;

	const [spanAttributeKeys, setSpanAttributeKeys] = useState<string[]>([]);
	const [resourceAttributeKeys, setResourceAttributeKeys] = useState<string[]>(
		[]
	);
	const [spanNames, setSpanNames] = useState<string[]>([]);
	const [models, setModels] = useState<string[]>([]);
	const [providers, setProviders] = useState<string[]>([]);
	const [applicationNames, setApplicationNames] = useState<string[]>([]);

	const { fireRequest: fireConfigRequest } = useFetchWrapper();
	const { fireRequest: fireAttrKeysRequest } = useFetchWrapper();

	useEffect(() => {
		if (signal !== "traces") return;
		const timeLimit = relativeLast24h();
		const body = JSON.stringify(
			sourceId ? { timeLimit, sourceId } : { timeLimit }
		);

		fireConfigRequest({
			body,
			requestType: "POST",
			url: "/api/metrics/request/config",
			successCb: (resp) => {
				const row = Array.isArray(resp?.data) ? resp.data[0] : resp?.data ?? resp;
				if (!row || typeof row !== "object") return;
				setModels(
					Array.isArray((row as any).models)
						? (row as any).models.map(String)
						: []
				);
				setProviders(
					Array.isArray((row as any).providers)
						? (row as any).providers.map(String)
						: []
				);
				setApplicationNames(
					Array.isArray((row as any).applicationNames)
						? (row as any).applicationNames.map(String)
						: []
				);
				setSpanNames(
					Array.isArray((row as any).spanNames)
						? (row as any).spanNames.map(String)
						: []
				);
			},
			failureCb: () => {
				/* metadata is optional for the builder */
			},
		});

		fireAttrKeysRequest({
			body,
			requestType: "POST",
			url: "/api/metrics/request/attribute-keys",
			successCb: (resp) => {
				if (!resp || typeof resp !== "object") return;
				setSpanAttributeKeys(
					Array.isArray((resp as any).spanAttributeKeys)
						? (resp as any).spanAttributeKeys.map(String)
						: []
				);
				setResourceAttributeKeys(
					Array.isArray((resp as any).resourceAttributeKeys)
						? (resp as any).resourceAttributeKeys.map(String)
						: []
				);
			},
			failureCb: () => {
				/* metadata is optional for the builder */
			},
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [signal, sourceId]);

	// Dynamic-first (Grafana getTagKeys): options come from the source's live
	// attribute keys. The curated fallback is added only in non-capability-aware
	// mode (built-in) or when the source has reported nothing yet, so dropdowns
	// are never empty but external sources show exactly what they can serve.
	const dynamicKeys = useMemo(
		() => uniqueSorted([...spanAttributeKeys, ...resourceAttributeKeys]),
		[spanAttributeKeys, resourceAttributeKeys]
	);

	const mergedKeyOptions = useMemo(() => {
		const includeFallback = !capabilityAware || dynamicKeys.length === 0;
		return uniqueSorted([
			...(includeFallback ? FALLBACK_GROUP_BY_KEYS : []),
			...dynamicKeys,
		]);
	}, [dynamicKeys, capabilityAware]);

	const attributeKeyOptions = mergedKeyOptions;
	const groupByOptions = mergedKeyOptions;

	const valueSuggestions = useMemo(() => {
		return uniqueSorted([
			...models,
			...providers,
			...applicationNames,
			...spanNames,
		]);
	}, [models, providers, applicationNames, spanNames]);

	const emit = (
		nextMode: StructuredMode,
		nextSignal: Signal,
		overrides: Partial<{
			limit: number;
			interval: string;
			groupBy: string[];
			aggregations: AggregationRow[];
			filters: FilterRow[];
			sort: SortRow | null;
			includePrevious: boolean;
		}> = {}
	) => {
		onChange({
			mode: nextMode,
			query: buildQuery(nextSignal, nextMode, {
				limit: overrides.limit ?? limit,
				interval: overrides.interval ?? interval,
				groupBy: overrides.groupBy ?? groupBy,
				aggregations: overrides.aggregations ?? aggregations,
				filters: overrides.filters ?? filters,
				sort: overrides.sort !== undefined ? overrides.sort : sort,
				includePrevious:
					overrides.includePrevious !== undefined
						? overrides.includePrevious
						: includePrevious,
			}),
		});
	};

	const aggregateBlocked = !supportsAggregation && mode !== "list";
	const showAggregateExtras = mode === "aggregate" || mode === "timeseries";

	const updateFilter = (idx: number, patch: Partial<FilterRow>) => {
		const next = [...filters];
		const current = filters[idx];
		const merged = { ...current, ...patch };
		if (patch.target && patch.target !== current.target) {
			merged.op = defaultOpForTarget(patch.target);
			if (patch.target !== "attribute") {
				merged.key = "";
				merged.scope = "span";
			}
			if (patch.target === "duration" && !/^\d/.test(merged.value)) {
				merged.value = "";
			}
		}
		if (patch.op && isUnaryOp(patch.op)) {
			merged.value = "";
		}
		next[idx] = merged;
		emit(mode, signal, { filters: next });
	};

	const valuePlaceholder = (f: FilterRow): string => {
		if (f.target === "duration") return WIDGET_STRUCTURED_DURATION_PLACEHOLDER;
		if (f.target === "status") return WIDGET_STRUCTURED_STATUS_PLACEHOLDER;
		if (f.target === "spanName") return WIDGET_STRUCTURED_SPAN_NAME_PLACEHOLDER;
		return WIDGET_STRUCTURED_VALUE_PLACEHOLDER;
	};

	const valueListId = (f: FilterRow): string | undefined => {
		if (f.target === "status") return statusListId;
		if (f.target === "spanName") return spanNamesListId;
		if (f.target === "attribute" && !isUnaryOp(f.op)) return groupByListId;
		return undefined;
	};

	return (
		<div className="space-y-3 rounded-md border border-stone-200 dark:border-stone-700 p-3 bg-stone-50 dark:bg-stone-900/40">
			<Label className="text-stone-900 dark:text-white text-sm font-medium">
				{WIDGET_STRUCTURED_BUILDER_TITLE}
			</Label>

			<datalist id={attrKeysListId}>
				{attributeKeyOptions.map((k) => (
					<option key={k} value={k} />
				))}
			</datalist>
			<datalist id={groupByListId}>
				{groupByOptions.map((k) => (
					<option key={k} value={k} />
				))}
				{valueSuggestions.map((v) => (
					<option key={`val-${v}`} value={v} />
				))}
			</datalist>
			<datalist id={spanNamesListId}>
				{spanNames.map((n) => (
					<option key={n} value={n} />
				))}
			</datalist>
			<datalist id={statusListId}>
				{STATUS_CODE_OPTIONS.map((s) => (
					<option key={s} value={s} />
				))}
			</datalist>
			<datalist id={sortFieldListId}>
				{groupByOptions.map((k) => (
					<option key={k} value={k} />
				))}
			</datalist>

			<div className="grid grid-cols-2 gap-3">
				<div className="space-y-1">
					<Label className="text-xs text-stone-500 dark:text-stone-400">
						{WIDGET_STRUCTURED_SIGNAL_LABEL}
					</Label>
					<Select
						value={signal}
						onValueChange={(v) => emit(mode, v as Signal)}
					>
						<SelectTrigger className={triggerClass}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent className={contentClass}>
							{availableSignals.map((s) => (
								<SelectItem key={s} value={s} className="dark:text-white">
									{s}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-1">
					<Label className="text-xs text-stone-500 dark:text-stone-400">
						{WIDGET_STRUCTURED_MODE_LABEL}
					</Label>
					<Select
						value={mode}
						onValueChange={(v) => emit(v as StructuredMode, signal)}
					>
						<SelectTrigger className={triggerClass}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent className={contentClass}>
							<SelectItem value="list" className="dark:text-white">
								{WIDGET_STRUCTURED_MODE_LIST}
							</SelectItem>
							<SelectItem value="aggregate" className="dark:text-white">
								{WIDGET_STRUCTURED_MODE_AGGREGATE}
							</SelectItem>
							<SelectItem value="timeseries" className="dark:text-white">
								{WIDGET_STRUCTURED_MODE_TIMESERIES}
							</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			{aggregateBlocked && (
				<p className="text-xs text-amber-600 dark:text-amber-400">
					{WIDGET_STRUCTURED_AGGREGATION_UNSUPPORTED}
				</p>
			)}

			{mode === "list" && (
				<div className="space-y-1">
					<Label className="text-xs text-stone-500 dark:text-stone-400">
						{WIDGET_STRUCTURED_LIMIT_LABEL}
					</Label>
					<Input
						type="number"
						min={1}
						value={limit ?? 100}
						onChange={(e) =>
							emit(mode, signal, { limit: Number(e.target.value) || 1 })
						}
						className={inputClass}
					/>
				</div>
			)}

			{mode === "timeseries" && (
				<div className="space-y-1">
					<Label className="text-xs text-stone-500 dark:text-stone-400">
						{WIDGET_STRUCTURED_INTERVAL_LABEL}
					</Label>
					<Input
						value={interval}
						placeholder="1h"
						onChange={(e) => emit(mode, signal, { interval: e.target.value })}
						className={inputClass}
					/>
				</div>
			)}

			{mode === "aggregate" && (
				<div className="space-y-1">
					<Label className="text-xs text-stone-500 dark:text-stone-400">
						{WIDGET_STRUCTURED_GROUP_BY_LABEL}
					</Label>
					<Input
						value={groupBy.join(", ")}
						placeholder={WIDGET_STRUCTURED_GROUP_BY_PLACEHOLDER}
						list={groupByListId}
						onChange={(e) =>
							emit(mode, signal, {
								groupBy: e.target.value
									.split(",")
									.map((v) => v.trim())
									.filter(Boolean),
							})
						}
						className={inputClass}
					/>
				</div>
			)}

			{showAggregateExtras && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<Label className="text-xs text-stone-500 dark:text-stone-400">
							{WIDGET_STRUCTURED_AGGREGATIONS_LABEL}
						</Label>
						<Button
							type="button"
							size="sm"
							variant="outline"
							className="h-7 px-2 text-xs border-stone-200 dark:border-stone-700 dark:text-white"
							onClick={() =>
								emit(mode, signal, {
									aggregations: [...aggregations, { fn: "count" }],
								})
							}
						>
							<Plus className="h-3 w-3 mr-1" />
							{WIDGET_STRUCTURED_ADD_AGGREGATION}
						</Button>
					</div>
					{aggregations.map((agg, idx) => (
						<div key={idx} className="flex items-center gap-2">
							<Select
								value={agg.fn}
								onValueChange={(v) => {
									const next = [...aggregations];
									next[idx] = { ...agg, fn: v as AggregationFn };
									emit(mode, signal, { aggregations: next });
								}}
							>
								<SelectTrigger className={`${triggerClass} w-28`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent className={contentClass}>
									{AGG_FNS.map((fn) => (
										<SelectItem key={fn} value={fn} className="dark:text-white">
											{fn}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Input
								value={agg.field || ""}
								placeholder={WIDGET_STRUCTURED_FIELD_PLACEHOLDER}
								list={attrKeysListId}
								onChange={(e) => {
									const next = [...aggregations];
									next[idx] = { ...agg, field: e.target.value };
									emit(mode, signal, { aggregations: next });
								}}
								className={inputClass}
							/>
							<Input
								value={agg.as || ""}
								placeholder={WIDGET_STRUCTURED_ALIAS_PLACEHOLDER}
								onChange={(e) => {
									const next = [...aggregations];
									next[idx] = { ...agg, as: e.target.value };
									emit(mode, signal, { aggregations: next });
								}}
								className={`${inputClass} w-24`}
							/>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								className="h-8 w-8 shrink-0 text-stone-500 hover:text-red-500"
								onClick={() =>
									emit(mode, signal, {
										aggregations: aggregations.filter((_, i) => i !== idx),
									})
								}
							>
								<Trash2 className="h-3.5 w-3.5" />
							</Button>
						</div>
					))}

					<div className="space-y-1 pt-1">
						<Label className="text-xs text-stone-500 dark:text-stone-400">
							{WIDGET_STRUCTURED_SORT_LABEL}
						</Label>
						<div className="flex items-center gap-2">
							<Input
								value={sort?.field || ""}
								placeholder={WIDGET_STRUCTURED_SORT_FIELD_PLACEHOLDER}
								list={sortFieldListId}
								onChange={(e) => {
									const field = e.target.value;
									emit(mode, signal, {
										sort: field.trim()
											? {
													field,
													direction: sort?.direction || "asc",
												}
											: null,
									});
								}}
								className={inputClass}
							/>
							<Select
								value={sort?.direction || "asc"}
								onValueChange={(v) => {
									emit(mode, signal, {
										sort: {
											field: sort?.field || "",
											direction: v as SortDirection,
										},
									});
								}}
								disabled={!sort?.field?.trim()}
							>
								<SelectTrigger className={`${triggerClass} w-32`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent className={contentClass}>
									<SelectItem value="asc" className="dark:text-white">
										{WIDGET_STRUCTURED_SORT_ASC}
									</SelectItem>
									<SelectItem value="desc" className="dark:text-white">
										{WIDGET_STRUCTURED_SORT_DESC}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="flex items-center gap-2 pt-1">
						<Checkbox
							id={`${listId}-prev`}
							checked={includePrevious}
							onCheckedChange={(checked) =>
								emit(mode, signal, { includePrevious: checked === true })
							}
							className="border-stone-300 dark:border-stone-600"
						/>
						<Label
							htmlFor={`${listId}-prev`}
							className="text-xs text-stone-600 dark:text-stone-300 cursor-pointer"
						>
							{WIDGET_STRUCTURED_PREVIOUS_PERIOD_LABEL}
						</Label>
					</div>
				</div>
			)}

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<Label className="text-xs text-stone-500 dark:text-stone-400">
						{WIDGET_STRUCTURED_FILTERS_LABEL}
					</Label>
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-7 px-2 text-xs border-stone-200 dark:border-stone-700 dark:text-white"
						onClick={() =>
							emit(mode, signal, {
								filters: [
									...filters,
									{
										target: "attribute",
										scope: "span",
										key: "",
										op: "eq",
										value: "",
									},
								],
							})
						}
					>
						<Plus className="h-3 w-3 mr-1" />
						{WIDGET_STRUCTURED_ADD_FILTER}
					</Button>
				</div>
				{filters.map((f, idx) => {
					const ops = OPS_BY_TARGET[f.target] || FILTER_OPS;
					const showScope = needsScope(f.target);
					const showKey = needsKey(f.target);
					const showValue = !isUnaryOp(f.op);
					return (
						<div key={idx} className="flex flex-wrap items-center gap-2">
							<Select
								value={f.target}
								onValueChange={(v) =>
									updateFilter(idx, { target: v as FilterTarget })
								}
							>
								<SelectTrigger
									className={`${triggerClass} w-28`}
									aria-label={WIDGET_STRUCTURED_FILTER_TARGET_LABEL}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent className={contentClass}>
									{FILTER_TARGETS.map((t) => (
										<SelectItem key={t} value={t} className="dark:text-white">
											{t}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{showScope ? (
								<Select
									value={f.scope}
									onValueChange={(v) =>
										updateFilter(idx, { scope: v as FilterScope })
									}
								>
									<SelectTrigger className={`${triggerClass} w-24`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent className={contentClass}>
										{FILTER_SCOPES.map((s) => (
											<SelectItem key={s} value={s} className="dark:text-white">
												{s}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : null}
							{showKey ? (
								<Input
									value={f.key}
									placeholder={WIDGET_STRUCTURED_KEY_PLACEHOLDER}
									list={attrKeysListId}
									onChange={(e) => updateFilter(idx, { key: e.target.value })}
									className={inputClass}
								/>
							) : null}
							<Select
								value={ops.includes(f.op) ? f.op : ops[0]}
								onValueChange={(v) => updateFilter(idx, { op: v as FilterOp })}
							>
								<SelectTrigger className={`${triggerClass} w-28`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent className={contentClass}>
									{ops.map((op) => (
										<SelectItem key={op} value={op} className="dark:text-white">
											{op}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{showValue ? (
								<Input
									value={f.value}
									placeholder={valuePlaceholder(f)}
									list={valueListId(f)}
									type={f.target === "duration" ? "number" : "text"}
									onChange={(e) => updateFilter(idx, { value: e.target.value })}
									className={inputClass}
								/>
							) : null}
							<Button
								type="button"
								size="icon"
								variant="ghost"
								className="h-8 w-8 shrink-0 text-stone-500 hover:text-red-500"
								onClick={() =>
									emit(mode, signal, {
										filters: filters.filter((_, i) => i !== idx),
									})
								}
							>
								<Trash2 className="h-3.5 w-3.5" />
							</Button>
						</div>
					);
				})}
			</div>
		</div>
	);
};

export default StructuredQueryBuilder;
