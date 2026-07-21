"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useEffect, useState } from "react";
import { EVALUATION_TYPES } from "@/constants/evaluation-types";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { Rule } from "@/types/rule-engine";
import { Layers, CheckCircle2, ChevronRight, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";

interface EvaluationTypeDisplay {
	id: string;
	label: string;
	description: string;
	enabledByDefault: boolean;
	enabled: boolean;
	isCustom?: boolean;
	rules?: Array<{ ruleId: string; priority: number }>;
	prompt?: string;
}

export default function EvaluationTypesSection() {
	const m = getMessage();
	const posthog = usePostHog();
	const { fireRequest: getTypes, data: typesResponse } = useFetchWrapper<
		EvaluationTypeDisplay[] | { data: any[] }
	>();
	const { fireRequest: getRules, data: rules } = useFetchWrapper<Rule[]>();
	const { fireRequest: getEvalEntities, data: evalEntities } = useFetchWrapper<
		Array<{ rule_id: string; entity_id: string }>
	>();

	const [allTypes, setAllTypes] = useState<EvaluationTypeDisplay[]>([]);

	const rulesLinkedToType = (evalEntities || []).reduce<
		Record<string, string[]>
	>((acc, e) => {
		if (!acc[e.entity_id]) acc[e.entity_id] = [];
		if (!acc[e.entity_id].includes(e.rule_id)) acc[e.entity_id].push(e.rule_id);
		return acc;
	}, {});

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.EVALUATION_TYPES_PAGE_VISITED);
		getTypes({
			requestType: "GET",
			url: "/api/evaluation/types",
			responseDataKey: "data",
			successCb: (response: EvaluationTypeDisplay[] | { data?: any[] }) => {
				const list = Array.isArray(response) ? response : response?.data;
				posthog?.capture(CLIENT_EVENTS.EVALUATION_TYPES_LIST, {
					count: Array.isArray(list) ? list.length : 0,
				});
			},
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
			setAllTypes(savedTypes);
		}
	}, [typesResponse]);

	const builtInIds = new Set<string>(EVALUATION_TYPES.map((et) => et.id));
	const builtInTypes = allTypes.filter((t) => builtInIds.has(t.id));
	const customTypes = allTypes.filter((t) => !builtInIds.has(t.id));

	const displayBuiltIn = EVALUATION_TYPES.map((et) => {
		const saved = builtInTypes.find((t) => t.id === et.id);
		return {
			...et,
			enabled: saved?.enabled ?? et.enabledByDefault,
			isCustom: false,
			rules: saved?.rules || [],
		};
	});

	const renderTypeCard = (type: EvaluationTypeDisplay, isCustomType: boolean) => {
		const hasRules =
			(type.rules?.length ?? 0) > 0 ||
			(rulesLinkedToType[type.id]?.length ?? 0) > 0;
		return (
			<Link key={type.id} href={`/evaluations/types/${type.id}`}>
				<Card
					className={`shadow-sm overflow-hidden transition-colors cursor-pointer ${
						isCustomType
							? "border-primary/20 dark:border-primary/15 hover:border-primary/40 dark:hover:border-primary/30"
							: "border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700"
					}`}
				>
					<CardHeader className="pb-3">
						<div className="flex items-start justify-between gap-4">
							<div className="flex-1 min-w-0">
								<CardTitle className="text-base flex items-center gap-2 flex-wrap text-stone-900 dark:text-stone-100">
									{type.label}
									{isCustomType && (
										<Badge
											variant="outline"
											className="text-xs font-normal gap-1 shrink-0 border-primary/30 text-primary dark:border-primary/20"
										>
											<Sparkles className="size-3" />
											{m.EVALUATION_TYPE_CUSTOM_BADGE}
										</Badge>
									)}
									{hasRules && (
										<Badge
											variant="outline"
											className="text-xs font-normal gap-1 shrink-0"
										>
											<CheckCircle2 className="size-3" />
											{m.EVALUATION_TYPE_RULE_ENGINE_BADGE}
										</Badge>
									)}
								</CardTitle>
								<p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
									{type.description}
								</p>
								{(rulesLinkedToType[type.id]?.length ?? 0) > 0 && (
									<div className="flex items-center gap-1.5 mt-2 flex-wrap">
										<span className="text-xs text-stone-500 dark:text-stone-400">
											{m.EVALUATION_TYPES_LINKED_FROM_RULES}
										</span>
										{rulesLinkedToType[type.id].slice(0, 3).map((rid) => {
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
										{rulesLinkedToType[type.id].length > 3 && (
											<span className="text-xs text-stone-400 dark:text-stone-500">
												+{rulesLinkedToType[type.id].length - 3} more
											</span>
										)}
									</div>
								)}
							</div>
							<div className="flex items-center gap-2 shrink-0">
								<Badge variant={type.enabled ? "default" : "secondary"}>
									{type.enabled
										? m.EVALUATION_TYPE_ENABLED
										: m.EVALUATION_TYPE_DISABLED}
								</Badge>
								<ChevronRight className="size-4 text-stone-400 dark:text-stone-500" />
							</div>
						</div>
					</CardHeader>
				</Card>
			</Link>
		);
	};

	return (
		<div className="w-full space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<h3 className="text-base font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">
						<Layers className="size-4" />
						{m.EVALUATION_TYPES_SECTION_TITLE}
					</h3>
					<p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
						{m.EVALUATION_TYPES_SECTION_DESCRIPTION}
					</p>
				</div>
				<Button asChild size="sm" className="h-8">
					<Link href="/evaluations/types/new">
						<Plus className="mr-1.5 h-3.5 w-3.5" />
						{m.EVALUATION_CREATE_CUSTOM_TYPE}
					</Link>
				</Button>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{displayBuiltIn.map((et) => renderTypeCard(et, false))}
			</div>

			{customTypes.length > 0 && (
				<>
					<div className="flex items-center gap-2 pt-2">
						<Sparkles className="size-4 text-primary" />
						<h4 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
							{m.EVALUATION_CUSTOM_TYPES_HEADING}
						</h4>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{customTypes.map((ct) => renderTypeCard(ct, true))}
					</div>
				</>
			)}
		</div>
	);
}
