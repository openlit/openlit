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

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
	WIDGET_STRUCTURED_FIELD_PLACEHOLDER,
	WIDGET_STRUCTURED_FILTERS_LABEL,
	WIDGET_STRUCTURED_GROUP_BY_LABEL,
	WIDGET_STRUCTURED_GROUP_BY_PLACEHOLDER,
	WIDGET_STRUCTURED_INTERVAL_LABEL,
	WIDGET_STRUCTURED_KEY_PLACEHOLDER,
	WIDGET_STRUCTURED_LIMIT_LABEL,
	WIDGET_STRUCTURED_MODE_AGGREGATE,
	WIDGET_STRUCTURED_MODE_LABEL,
	WIDGET_STRUCTURED_MODE_LIST,
	WIDGET_STRUCTURED_MODE_TIMESERIES,
	WIDGET_STRUCTURED_SIGNAL_LABEL,
	WIDGET_STRUCTURED_VALUE_PLACEHOLDER,
} from "@/constants/messages/en";

type StructuredMode = "list" | "aggregate" | "timeseries";
type Signal = "traces" | "logs" | "metrics";
type FilterScope = "span" | "resource" | "log" | "metric";
type FilterOp = "eq" | "neq" | "contains" | "in";
type AggregationFn = "count" | "sum" | "avg" | "min" | "max" | "p50" | "p95" | "p99";

interface FilterRow {
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
}

const inputClass =
	"h-8 bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700 dark:text-white text-sm";
const triggerClass =
	"h-8 bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700 dark:text-white text-sm";
const contentClass =
	"bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700";

const DEFAULT_SIGNAL: Signal = "traces";

function toFilterRows(filters: unknown): FilterRow[] {
	if (!Array.isArray(filters)) return [];
	return filters
		.filter((f) => f && typeof f === "object" && (f as any).target === "attribute")
		.map((f) => {
			const r = f as Record<string, any>;
			return {
				scope: (r.scope as FilterScope) || "span",
				key: String(r.key || ""),
				op: (r.op as FilterOp) || "eq",
				value: Array.isArray(r.value) ? r.value.join(", ") : String(r.value ?? ""),
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
	}
): Record<string, any> {
	const filters = opts.filters
		.filter((f) => f.key.trim())
		.map((f) => ({
			target: "attribute",
			scope: f.scope,
			key: f.key.trim(),
			op: f.op,
			value:
				f.op === "in"
					? f.value.split(",").map((v) => v.trim()).filter(Boolean)
					: f.value,
		}));

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
	}
	return query;
}

const AGG_FNS: AggregationFn[] = [
	"count",
	"sum",
	"avg",
	"min",
	"max",
	"p50",
	"p95",
	"p99",
];
const FILTER_SCOPES: FilterScope[] = ["span", "resource", "log", "metric"];
const FILTER_OPS: FilterOp[] = ["eq", "neq", "contains", "in"];

export const StructuredQueryBuilder: React.FC<Props> = ({
	signals,
	supportsAggregation = true,
	value,
	onChange,
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

	const emit = (
		nextMode: StructuredMode,
		nextSignal: Signal,
		overrides: Partial<{
			limit: number;
			interval: string;
			groupBy: string[];
			aggregations: AggregationRow[];
			filters: FilterRow[];
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
			}),
		});
	};

	const aggregateBlocked = !supportsAggregation && mode !== "list";

	return (
		<div className="space-y-3 rounded-md border border-stone-200 dark:border-stone-700 p-3 bg-stone-50 dark:bg-stone-900/40">
			<Label className="text-stone-900 dark:text-white text-sm font-medium">
				{WIDGET_STRUCTURED_BUILDER_TITLE}
			</Label>

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

			{(mode === "aggregate" || mode === "timeseries") && (
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
								filters: [...filters, { scope: "span", key: "", op: "eq", value: "" }],
							})
						}
					>
						<Plus className="h-3 w-3 mr-1" />
						{WIDGET_STRUCTURED_ADD_FILTER}
					</Button>
				</div>
				{filters.map((f, idx) => (
					<div key={idx} className="flex items-center gap-2">
						<Select
							value={f.scope}
							onValueChange={(v) => {
								const next = [...filters];
								next[idx] = { ...f, scope: v as FilterScope };
								emit(mode, signal, { filters: next });
							}}
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
						<Input
							value={f.key}
							placeholder={WIDGET_STRUCTURED_KEY_PLACEHOLDER}
							onChange={(e) => {
								const next = [...filters];
								next[idx] = { ...f, key: e.target.value };
								emit(mode, signal, { filters: next });
							}}
							className={inputClass}
						/>
						<Select
							value={f.op}
							onValueChange={(v) => {
								const next = [...filters];
								next[idx] = { ...f, op: v as FilterOp };
								emit(mode, signal, { filters: next });
							}}
						>
							<SelectTrigger className={`${triggerClass} w-24`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent className={contentClass}>
								{FILTER_OPS.map((op) => (
									<SelectItem key={op} value={op} className="dark:text-white">
										{op}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Input
							value={f.value}
							placeholder={WIDGET_STRUCTURED_VALUE_PLACEHOLDER}
							onChange={(e) => {
								const next = [...filters];
								next[idx] = { ...f, value: e.target.value };
								emit(mode, signal, { filters: next });
							}}
							className={inputClass}
						/>
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
				))}
			</div>
		</div>
	);
};

export default StructuredQueryBuilder;
