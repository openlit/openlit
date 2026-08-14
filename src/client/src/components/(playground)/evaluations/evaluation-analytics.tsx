"use client";

import { useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { round } from "lodash";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterDetails } from "@/selectors/filter";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";
import getMessage from "@/constants/messages";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const { data, isLoading, isFetched, fireRequest } =
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

	const loading = isLoading || !isFetched || pingStatus === "pending";

	if (isFetched && data && !data.configured) {
		return <EvaluationOnboarding onConfigure={onConfigure} />;
	}

	const byType = buildEvaluatorRows(
		(data?.byType || []) as EvaluationAnalyticsByTypeRow[],
		configuredTypes
	);

	return (
		<div className="flex flex-col gap-4 w-full">
			<EvaluationsDashboard />

			<Card className="overflow-hidden border-stone-200 shadow-sm dark:border-stone-800">
				<CardContent className="p-0">
					{loading ? (
						<div className="p-4">
							<Skeleton className="h-24 w-full" />
						</div>
					) : byType.length === 0 ? (
						<div className="px-4 py-8 text-center text-sm text-stone-500 dark:text-stone-400">
							{m.EVALUATION_TABLE_EMPTY}
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-y border-stone-200 text-left text-[11px] uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:text-stone-400">
										<th className="px-4 py-2 font-medium">
											{m.EVALUATION_TABLE_EVALUATION}
										</th>
										<th className="px-4 py-2 font-medium">
											{m.EVALUATION_TABLE_MATCHER}
										</th>
										<th className="px-4 py-2 font-medium text-right">
											{m.EVALUATION_TABLE_EXECUTIONS}
										</th>
										<th className="px-4 py-2 font-medium text-right">
											{m.EVALUATION_TABLE_PASS_RATE}
										</th>
										<th className="px-4 py-2 font-medium text-right">
											{m.EVALUATION_TABLE_PASS_RATE_TREND}
										</th>
									</tr>
								</thead>
								<tbody>
									{byType.map((row) => {
										const ruleIds = matcherByType[row.id] || [];
										const matcher =
											ruleIds.length === 0
												? m.EVALUATION_TABLE_MATCHER_DEFAULT
												: ruleIds
														.slice(0, 2)
														.map((rid) => {
															const rule = (rules || []).find(
																(r) => r.id === rid
															);
															return rule?.name || rid.slice(0, 8);
														})
														.join(", ") +
													(ruleIds.length > 2
														? ` +${ruleIds.length - 2}`
														: "");
										const trend = changePercent(
											row.passRate,
											row.previousPassRate
										);

										return (
											<tr
												key={row.key}
												className="border-b border-stone-100 hover:bg-stone-50 dark:border-stone-900 dark:hover:bg-stone-900/50"
											>
												<td className="px-4 py-2.5">
													<Link
														href={`/evaluations/evaluators/${encodeURIComponent(row.id)}`}
														className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
													>
														<span
															className={`inline-block h-1.5 w-1.5 rounded-full ${
																row.enabled
																	? "bg-emerald-500"
																	: "bg-stone-400"
															}`}
														/>
														{row.label}
													</Link>
												</td>
												<td className="px-4 py-2.5 font-mono text-xs text-stone-500 dark:text-stone-400">
													{matcher}
												</td>
												<td className="px-4 py-2.5 text-right tabular-nums text-stone-800 dark:text-stone-200">
													{row.executions.toLocaleString()}
												</td>
												<td
													className={`px-4 py-2.5 text-right tabular-nums font-medium ${passRateClass(row.passRate)}`}
												>
													{round(row.passRate, 0)}%
												</td>
												<td className="px-4 py-2.5 text-right">
													<span
														className={`inline-flex items-center gap-0.5 text-xs ${
															trend === 0
																? "text-stone-500"
																: trend > 0
																	? "text-emerald-600 dark:text-emerald-400"
																	: "text-rose-600 dark:text-rose-400"
														}`}
													>
														{trend === 0 ? (
															<Minus className="h-3 w-3" />
														) : trend > 0 ? (
															<TrendingUp className="h-3 w-3" />
														) : (
															<TrendingDown className="h-3 w-3" />
														)}
														{trend === 0
															? "0%"
															: `${trend > 0 ? "+" : ""}${trend}%`}
													</span>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
