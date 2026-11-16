"use client";

import { useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { round } from "lodash";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterDetails } from "@/selectors/filter";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";
import getMessage from "@/constants/messages";
import { Columns } from "@/components/data-table/columns";
import DataTable from "@/components/data-table/table";
import IntermediateState from "@/components/(playground)/intermediate-state";
import { Button } from "@/components/ui/button";
import EvaluationOnboarding from "./evaluation-onboarding";
import EvaluationsDashboard from "@/app/(playground)/dashboard/evaluations";
import type {
	EvaluationAnalyticsByTypeRow,
	EvaluationAnalyticsResponse,
} from "@/types/evaluation";
import {
	displayEvaluationTypeName,
	resolveEvaluationType,
	type EvaluationTypeRef,
} from "@/helpers/client/evaluation-type";
import { Rule } from "@/types/rule-engine";
import { EVALUATION_TYPES } from "@/constants/evaluation-types";

function changePercent(current: number, previous: number) {
	return round(((current - previous) / (previous || 1)) * 100, 1);
}

function passRateClass(rate: number) {
	if (rate >= 90) return "text-emerald-600 dark:text-emerald-400";
	if (rate >= 75) return "text-lime-600 dark:text-lime-400";
	return "text-amber-600 dark:text-amber-400";
}

type ConfiguredType = EvaluationTypeRef & { enabled?: boolean };

type MergedTypeRow = {
	key: string;
	id: string;
	label: string;
	enabled: boolean;
	executions: number;
	passRate: number;
	previousPassRate: number;
};

type EvaluatorRow = MergedTypeRow & { matcher: string; trend: number };

const evaluatorColumns: Columns<string, EvaluatorRow> = {
	evaluation: {
		header: () => getMessage().EVALUATION_TABLE_EVALUATION,
		width: "minmax(12rem, 1.6fr)",
		cell: ({ row }) => (
			<Link
				href={`/evaluations/evaluators/${encodeURIComponent(row.id)}`}
				className="inline-flex min-w-0 items-center gap-2 rounded font-medium text-stone-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-stone-100"
				onClick={(e) => e.stopPropagation()}
			>
				<span
					className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
						row.enabled ? "bg-emerald-500" : "bg-stone-400"
					}`}
				/>
				<span className="truncate">{row.label}</span>
			</Link>
		),
	},
	matcher: {
		header: () => getMessage().EVALUATION_TABLE_MATCHER,
		cell: ({ row }) => (
			<span className="block truncate font-mono text-xs text-stone-500 dark:text-stone-400">
				{row.matcher}
			</span>
		),
	},
	executions: {
		header: () => getMessage().EVALUATION_TABLE_EXECUTIONS,
		className: "text-right",
		cell: ({ row }) => (
			<span className="tabular-nums">{row.executions.toLocaleString()}</span>
		),
	},
	passRate: {
		header: () => getMessage().EVALUATION_TABLE_PASS_RATE,
		className: "text-right",
		cell: ({ row }) => (
			row.executions === 0 ? (
				<span className="text-stone-500 dark:text-stone-400">—</span>
			) : (
				<span className={`font-medium tabular-nums ${passRateClass(row.passRate)}`}>
					{round(row.passRate, 0)}%
				</span>
			)
		),
	},
	trend: {
		header: () => getMessage().EVALUATION_TABLE_PASS_RATE_TREND,
		className: "text-right",
		cell: ({ row }) => (
			<span
				className={`inline-flex items-center gap-0.5 text-xs tabular-nums ${
					row.trend === 0
						? "text-stone-500 dark:text-stone-400"
						: row.trend > 0
							? "text-emerald-600 dark:text-emerald-400"
							: "text-rose-600 dark:text-rose-400"
				}`}
			>
				{row.trend === 0 ? (
					<Minus className="h-3 w-3" />
				) : row.trend > 0 ? (
					<TrendingUp className="h-3 w-3" />
				) : (
					<TrendingDown className="h-3 w-3" />
				)}
				{row.trend === 0 ? "0%" : `${row.trend > 0 ? "+" : ""}${row.trend}%`}
			</span>
		),
	},
};

const EVALUATOR_VISIBLE_COLUMNS = {
	evaluation: true,
	matcher: true,
	executions: true,
	passRate: true,
	trend: true,
};

/**
 * Keep only configured evaluators (built-in + custom). Drop random LLM
 * labels that do not map to a real evaluation type.
 */
function buildEvaluatorRows(
	rows: EvaluationAnalyticsByTypeRow[],
	configuredTypes: ConfiguredType[]
): MergedTypeRow[] {
	const statsById = new Map<string, MergedTypeRow>();

	for (const row of rows) {
		const resolved = resolveEvaluationType(row.evaluation, configuredTypes);
		if (!resolved) continue;

		const existing = statsById.get(resolved.id);
		if (!existing) {
			const configured = configuredTypes.find((t) => t.id === resolved.id);
			statsById.set(resolved.id, {
				key: resolved.id,
				id: resolved.id,
				label: resolved.label,
				enabled: configured?.enabled ?? true,
				executions: row.executions,
				passRate: row.passRate,
				previousPassRate: row.previousPassRate,
			});
			continue;
		}

		const totalExec = existing.executions + row.executions;
		existing.passRate =
			totalExec === 0
				? 0
				: (existing.passRate * existing.executions +
						row.passRate * row.executions) /
					totalExec;
		existing.previousPassRate =
			totalExec === 0
				? 0
				: (existing.previousPassRate * existing.executions +
						row.previousPassRate * row.executions) /
					totalExec;
		existing.executions = totalExec;
	}

	const rowsOut: MergedTypeRow[] = [];
	for (const type of configuredTypes) {
		const stats = statsById.get(type.id);
		if (stats) {
			rowsOut.push(stats);
			continue;
		}
		if (type.enabled) {
			rowsOut.push({
				key: type.id,
				id: type.id,
				label: type.label || displayEvaluationTypeName(type.id),
				enabled: true,
				executions: 0,
				passRate: 0,
				previousPassRate: 0,
			});
		}
	}

	return rowsOut.sort((a, b) => b.executions - a.executions);
}

export default function EvaluationAnalytics({
	onConfigure,
}: {
	onConfigure: () => void;
}) {
	const m = getMessage();
	const router = useRouter();
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const { data, isLoading, isFetched, fireRequest, error } =
		useFetchWrapper<EvaluationAnalyticsResponse>();
	const { data: typesResponse, fireRequest: getTypes } = useFetchWrapper<
		ConfiguredType[] | { data?: ConfiguredType[] }
	>();
	const { data: rules, fireRequest: getRules } = useFetchWrapper<Rule[]>();
	const { data: evalEntities, fireRequest: getEvalEntities } = useFetchWrapper<
		Array<{ rule_id: string; entity_id: string }>
	>();

	const fetchAnalytics = useCallback(() => {
		fireRequest({
			body: JSON.stringify(getFilterParamsForDashboard(filter)),
			requestType: "POST",
			url: "/api/evaluation/analytics",
		});
	}, [filter, fireRequest]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		) {
			fetchAnalytics();
		}
	}, [filter, fetchAnalytics, pingStatus]);

	useEffect(() => {
		getTypes({
			requestType: "GET",
			url: "/api/evaluation/types",
			responseDataKey: "data",
		});
		getRules({ requestType: "GET", url: "/api/rule-engine/rules" });
		getEvalEntities({
			requestType: "GET",
			url: "/api/rule-engine/entities?entity_type=evaluation",
		});
	}, [getTypes, getRules, getEvalEntities]);

	const configuredTypes = useMemo(() => {
		const list = Array.isArray(typesResponse)
			? typesResponse
			: typesResponse?.data;
		if (Array.isArray(list) && list.length > 0) {
			return list
				.filter((t) => t?.id)
				.map((t) => ({
					id: t.id,
					label: t.label || t.id,
					enabled: t.enabled ?? true,
				}));
		}
		return EVALUATION_TYPES.map((t) => ({
			id: t.id,
			label: t.label,
			enabled: t.enabledByDefault,
		}));
	}, [typesResponse]);

	const matcherByType = useMemo(() => {
		const map: Record<string, string[]> = {};
		for (const entity of evalEntities || []) {
			if (!map[entity.entity_id]) map[entity.entity_id] = [];
			if (!map[entity.entity_id].includes(entity.rule_id)) {
				map[entity.entity_id].push(entity.rule_id);
			}
		}
		return map;
	}, [evalEntities]);

	if (isFetched && data && !data.configured) {
		return <EvaluationOnboarding onConfigure={onConfigure} />;
	}

	// Only build rows once analytics have loaded; otherwise configured-but-unloaded
	// evaluators render as misleading "0 / 0%" rows next to the skeleton.
	const byType: EvaluatorRow[] = !data
		? []
		: buildEvaluatorRows(
		(data?.byType || []) as EvaluationAnalyticsByTypeRow[],
		configuredTypes
	).map((row) => {
		const ruleIds = matcherByType[row.id] || [];
		const matcher =
			ruleIds.length === 0
				? m.EVALUATION_TABLE_MATCHER_DEFAULT
				: ruleIds
						.slice(0, 2)
						.map((rid) => {
							const rule = (rules || []).find((r) => r.id === rid);
							return rule?.name || rid.slice(0, 8);
						})
						.join(", ") +
					(ruleIds.length > 2 ? ` +${ruleIds.length - 2}` : "");
		return {
			...row,
			matcher,
			trend: changePercent(row.passRate, row.previousPassRate),
		};
	});

	return (
		<div className="flex w-full flex-col gap-4">
			<EvaluationsDashboard />

			{/* Shown even when earlier rows are still on screen, so a failed
			    refresh is visible and can be retried. */}
			{error ? (
				<div
					role="alert"
					className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm dark:border-rose-900/70 dark:bg-rose-950/30"
				>
					<div className="min-w-0">
						<p className="font-medium text-rose-700 dark:text-rose-300">
							{m.EVALUATION_ANALYTICS_LOAD_FAILED}
						</p>
						<p className="truncate text-xs text-stone-600 dark:text-stone-400">
							{String(error)}
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						className="h-7 shrink-0"
						onClick={fetchAnalytics}
						disabled={isLoading}
					>
						{m.RETRY}
					</Button>
				</div>
			) : null}

			<DataTable
				columns={evaluatorColumns}
				data={byType}
				isFetched={isFetched && pingStatus !== "pending"}
				isLoading={isLoading}
				visibilityColumns={EVALUATOR_VISIBLE_COLUMNS}
				getRowKey={(row: EvaluatorRow) => row.key}
				onClick={(row: EvaluatorRow) =>
					router.push(`/evaluations/evaluators/${encodeURIComponent(row.id)}`)
				}
				emptyState={
					error ? null : (
						<IntermediateState type="nodata">
							{m.EVALUATION_TABLE_EMPTY}
						</IntermediateState>
					)
				}
			/>
		</div>
	);
}
