"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useEffect, useState } from "react";
import { EVALUATION_TYPES } from "@/constants/evaluation-types";
import { Rule } from "@/types/rule-engine";
import { Layers, CheckCircle2, ChevronRight, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface EvaluationTypeConfig {
	id: string;
	enabled: boolean;
	rules?: Array<{ ruleId: string; priority: number }>;
}

export default function EvaluationTypesPage() {
	const { fireRequest: getTypes, data: typesResponse } = useFetchWrapper<
		EvaluationTypeConfig[] | { data: any[] }
	>();
	const { fireRequest: getRules, data: rules } = useFetchWrapper<Rule[]>();
	const { fireRequest: getEvalEntities, data: evalEntities } = useFetchWrapper<
		Array<{ rule_id: string; entity_id: string }>
	>();
	const [typeConfigs, setTypeConfigs] = useState<
		Record<string, { enabled: boolean; rulesCount: number }>
	>({});

	const rulesLinkedToType = (evalEntities || []).reduce<
		Record<string, string[]>
	>((acc, e) => {
		if (!acc[e.entity_id]) acc[e.entity_id] = [];
		if (!acc[e.entity_id].includes(e.rule_id)) acc[e.entity_id].push(e.rule_id);
		return acc;
	}, {});

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
	}, []);

	useEffect(() => {
		const savedTypes = Array.isArray(typesResponse)
			? typesResponse
			: (typesResponse as { data?: any[] })?.data;
		if (savedTypes !== undefined && Array.isArray(savedTypes)) {
			const map: Record<string, { enabled: boolean; rulesCount: number }> = {};
			for (const et of EVALUATION_TYPES) {
				const existing = savedTypes.find((t: any) => t.id === et.id);
				const rules = existing?.rules || [];
				map[et.id] = {
					enabled: existing?.enabled ?? et.enabledByDefault,
					rulesCount: Array.isArray(rules) ? rules.filter((r: any) => r?.ruleId).length : 0,
				};
			}
			setTypeConfigs(map);
		}
	}, [typesResponse]);

	return (
		<div className="flex flex-1 h-full w-full p-6 overflow-auto">
			<div className="w-full space-y-6">
				<div className="flex items-start gap-4">
					<Link href="/evaluations/settings">
						<Button
							variant="outline"
							size="icon"
							className="shrink-0 text-stone-700 dark:text-stone-200 border-stone-300 dark:border-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800"
						>
							<ArrowLeft className="size-4" />
						</Button>
					</Link>
					<div>
						<h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-2">
							<Layers className="size-5" />
							Evaluation Types
						</h2>
						<p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
							Configure each evaluation type individually. Click a type to set rules,
							priorities, and prebuilt context.
						</p>
					</div>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{EVALUATION_TYPES.map((et) => {
						const config = typeConfigs[et.id] ?? {
							enabled: et.enabledByDefault,
							rulesCount: 0,
						};
						const hasRules =
							config.rulesCount > 0 ||
							(rulesLinkedToType[et.id]?.length ?? 0) > 0;
						return (
							<Link key={et.id} href={`/evaluations/types/${et.id}`}>
								<Card className="border-stone-200 dark:border-stone-800 shadow-sm overflow-hidden hover:border-stone-300 dark:hover:border-stone-700 transition-colors cursor-pointer">
									<CardHeader className="pb-3">
										<div className="flex items-start justify-between gap-4">
											<div className="flex-1 min-w-0">
												<CardTitle className="text-base flex items-center gap-2 flex-wrap">
													{et.label}
													{hasRules && (
														<Badge
															variant="outline"
															className="text-xs font-normal gap-1 shrink-0"
														>
															<CheckCircle2 className="size-3" />
															Rule engine
														</Badge>
													)}
												</CardTitle>
												<p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
													{et.description}
												</p>
												{(rulesLinkedToType[et.id]?.length ?? 0) > 0 && (
													<div className="flex items-center gap-1.5 mt-2 flex-wrap">
														<span className="text-xs text-stone-500 dark:text-stone-400">
															Linked from rules:
														</span>
														{rulesLinkedToType[et.id].slice(0, 3).map((rid) => {
															const r = (rules || []).find((x) => x.id === rid);
															return (
																<span
																	key={rid}
																	className="inline-flex items-center gap-1 text-xs text-primary"
																>
																	{r?.name || rid.slice(0, 8)}
																</span>
															);
														})}
														{rulesLinkedToType[et.id].length > 3 && (
															<span className="text-xs text-stone-400">
																+{rulesLinkedToType[et.id].length - 3} more
															</span>
														)}
													</div>
												)}
											</div>
											<div className="flex items-center gap-2 shrink-0">
												<Badge
													variant={config.enabled ? "default" : "secondary"}
												>
													{config.enabled ? "Enabled" : "Disabled"}
												</Badge>
												<ChevronRight className="size-4 text-stone-400" />
											</div>
										</div>
									</CardHeader>
								</Card>
							</Link>
						);
					})}
				</div>
			</div>
		</div>
	);
}
