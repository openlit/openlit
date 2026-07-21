"use client";

import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useEffect, useState } from "react";
import { EVALUATION_TYPES } from "@/constants/evaluation-types";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { Rule } from "@/types/rule-engine";
import { toast } from "sonner";
import { Link2, Plus, Trash2, ExternalLink, ArrowLeft, Sparkles, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import getMessage from "@/constants/messages";

interface RuleWithPriority {
	ruleId: string;
	priority: number;
}

interface EvaluationTypeConfig {
	id: string;
	enabled: boolean;
	isCustom?: boolean;
	label?: string;
	description?: string;
	rules: RuleWithPriority[];
	prompt?: string;
	defaultPrompt?: string;
	thresholdScore?: number;
}

export default function EvaluationTypeDetailPage() {
	const posthog = usePostHog();
	const params = useParams();
	const router = useRouter();
	const typeId = params.id as string;
	const et = EVALUATION_TYPES.find((e) => e.id === typeId);

	const [config, setConfig] = useState<EvaluationTypeConfig | null>(null);
	const [notFound, setNotFound] = useState(false);
	const { fireRequest: getType, data: typeResponse, error: typeError, isFetched: typeFetched } =
		useFetchWrapper<{
			data?: EvaluationTypeConfig;
		}>();
	const { fireRequest: getRules, data: rules } = useFetchWrapper<Rule[]>();
	const { fireRequest: getEvalEntities, data: evalEntities } = useFetchWrapper<
		Array<{ rule_id: string; entity_id: string }>
	>();
	const { fireRequest: saveType, isLoading: isSaving } = useFetchWrapper();
	const { fireRequest: deleteType, isLoading: isDeleting } = useFetchWrapper();

	const rulesLinkedFromRulePage = (evalEntities || [])
		.filter((e) => e.entity_id === typeId)
		.map((e) => e.rule_id);

	useEffect(() => {
		setNotFound(false);
		setConfig(null);
		posthog?.capture(CLIENT_EVENTS.EVALUATION_TYPE_EDIT_PAGE_VISITED);
		getType({
			requestType: "GET",
			url: `/api/evaluation/types/${encodeURIComponent(typeId)}`,
			responseDataKey: "data",
		});
		getRules({ requestType: "GET", url: "/api/rule-engine/rules" });
		getEvalEntities({
			requestType: "GET",
			url: "/api/rule-engine/entities?entity_type=evaluation",
		});
	}, [typeId]);

	useEffect(() => {
		const res = typeResponse as { data?: EvaluationTypeConfig } | undefined;
		const data = res?.data ?? (typeResponse as EvaluationTypeConfig | undefined);
		if (data?.id) {
			setNotFound(false);
			setConfig({
				id: data.id,
				enabled: data.enabled ?? false,
				isCustom: data.isCustom,
				label: data.label,
				description: data.description,
				rules: data.rules || [],
				prompt: data.prompt,
				defaultPrompt: data.defaultPrompt,
				thresholdScore: data.thresholdScore,
			});
			return;
		}

		if (et) {
			setNotFound(false);
			setConfig({
				id: et.id,
				enabled: et.enabledByDefault,
				rules: [],
				prompt: data?.prompt,
				defaultPrompt: data?.defaultPrompt,
				thresholdScore: data?.thresholdScore,
			});
			return;
		}

		if (typeFetched && (typeError || !data?.id)) {
			setNotFound(true);
		}
	}, [typeResponse, et, typeFetched, typeError]);

	const handleToggle = (enabled: boolean) => {
		setConfig((prev) => (prev ? { ...prev, enabled } : null));
	};

	const handleAddRule = () => {
		setConfig((prev) =>
			prev ? { ...prev, rules: [...prev.rules, { ruleId: "", priority: 0 }] } : null
		);
	};

	const handleRemoveRule = (index: number) => {
		setConfig((prev) =>
			prev ? { ...prev, rules: prev.rules.filter((_, i) => i !== index) } : null
		);
	};

	const handleRuleChange = (index: number, ruleId: string | undefined) => {
		setConfig((prev) =>
			prev
				? {
					...prev,
					rules: prev.rules.map((r, i) =>
						i === index ? { ...r, ruleId: ruleId || "" } : r
					),
				}
				: null
		);
	};

	const handlePriorityChange = (index: number, priority: number) => {
		setConfig((prev) =>
			prev
				? {
					...prev,
					rules: prev.rules.map((r, i) =>
						i === index ? { ...r, priority } : r
					),
				}
				: null
		);
	};

	const handleSave = () => {
		if (!config) return;
		const payload: Record<string, any> = {
			enabled: config.enabled,
			rules: config.rules.filter((r) => r.ruleId),
			prompt: config.prompt?.trim() || undefined,
			thresholdScore: config.thresholdScore,
		};
		if (config.isCustom) {
			payload.isCustom = true;
			payload.label = config.label;
			payload.description = config.description;
		}
		saveType({
			requestType: "PATCH",
			url: `/api/evaluation/types/${typeId}`,
			body: JSON.stringify(payload),
			responseDataKey: "data",
			successCb: () => {
				toast.success("Evaluation type updated");
				getType({
					requestType: "GET",
					url: `/api/evaluation/types/${typeId}`,
					responseDataKey: "data",
				});
				getEvalEntities({
					requestType: "GET",
					url: "/api/rule-engine/entities?entity_type=evaluation",
				});
			},
			failureCb: (err?: string) => toast.error(err || "Failed to save"),
		});
	};

	const handleDelete = () => {
		if (!confirm(`Delete custom evaluation type "${displayLabel}"? This cannot be undone.`)) return;
		deleteType({
			requestType: "DELETE",
			url: `/api/evaluation/types/${typeId}`,
			responseDataKey: "data",
			successCb: () => {
				toast.success("Custom evaluation type deleted");
				router.push("/evaluations?tab=evaluators");
			},
			failureCb: (err?: string) => toast.error(err || "Failed to delete"),
		});
	};

	// Derive display label/description from built-in constant or custom type from API
	const isCustom = !et && config?.isCustom;
	const displayLabel = et?.label || config?.label || typeId;
	const displayDescription = et?.description || config?.description || "";

	const evaluatorsHref = "/evaluations?tab=evaluators";
	const backLabel = getMessage().EVALUATION_BACK_TO_TYPES;

	const header = (
		<FeaturePageHeader
			eyebrow={getMessage().FEATURE_EVALS}
			title={displayLabel}
			icon={<Layers className="h-4 w-4" />}
			tone="border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/40 dark:text-orange-300"
			leading={
				<Button
					asChild
					variant="outline"
					size="sm"
					className="h-7 w-7 shrink-0 p-0"
				>
					<Link href={evaluatorsHref} title={backLabel} aria-label={backLabel}>
						<ArrowLeft className="h-3.5 w-3.5" />
					</Link>
				</Button>
			}
			actions={
				isCustom ? (
					<Badge variant="outline" className="h-8 gap-1 border-primary/30 text-primary">
						<Sparkles className="size-3" />
						Custom
					</Badge>
				) : null
			}
		/>
	);

	if (notFound) {
		return (
			<div className="flex h-full w-full flex-col overflow-hidden">
				{header}
				<div className="flex flex-1 w-full flex-col items-center justify-center gap-3 p-4 text-center">
					<p className="text-base font-medium text-stone-800 dark:text-stone-200">
						{getMessage().EVALUATION_TYPE_NOT_FOUND}
					</p>
					<p className="max-w-md text-sm text-stone-500 dark:text-stone-400">
						{getMessage().EVALUATION_TYPE_NOT_FOUND_DESCRIPTION}
					</p>
					<Button asChild variant="outline" size="sm" className="h-8">
						<Link href="/evaluations?tab=evaluators">
							{getMessage().EVALUATION_BACK_TO_TYPES}
						</Link>
					</Button>
				</div>
			</div>
		);
	}

	if (!et && !config) {
		return (
			<div className="flex h-full w-full flex-col overflow-hidden">
				{header}
				<div className="flex flex-1 w-full items-center justify-center p-4">
					<p className="text-stone-500">Loading...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			{header}

			<div className="grid flex-1 grid-cols-3 gap-4 overflow-auto p-4">
				<div className="grid col-span-2 gap-4">
					<Card className="border-stone-200 dark:border-stone-800 shadow-sm">
						<CardHeader className="pb-4">
							<CardTitle className="text-base">Purpose</CardTitle>
							<p className="text-sm text-stone-500 dark:text-stone-400 font-normal">
								{displayDescription}
							</p>
						</CardHeader>
					</Card>

					{(config?.defaultPrompt || config?.prompt !== undefined) && (
						<Card className="border-stone-200 dark:border-stone-800 shadow-sm">
							<CardHeader className="pb-2">
								<CardTitle className="text-base">Prompt / Context</CardTitle>
								<p className="text-xs text-stone-500 dark:text-stone-400 font-normal">
									Appended to rule-engine context when evaluating. Override the default to customize.
								</p>
							</CardHeader>
							<CardContent>
								<textarea
									className="w-full min-h-[120px] text-xs bg-stone-50 dark:bg-stone-900/50 text-stone-900 dark:text-stone-100 p-3 rounded-lg border border-stone-200 dark:border-stone-700 font-mono resize-y placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
									value={
										config?.prompt ?? config?.defaultPrompt ?? ""
									}
									onChange={(e) =>
										setConfig((prev) =>
											prev ? { ...prev, prompt: e.target.value } : null
										)
									}
									placeholder="Custom prompt for this evaluation type..."
								/>
							</CardContent>
						</Card>
					)}

					<Card className="border-stone-200 dark:border-stone-800 shadow-sm">
						<CardHeader className="pb-2">
							<CardTitle className="text-base">
								{getMessage().EVALUATION_TYPE_THRESHOLD_LABEL}
							</CardTitle>
							<p className="text-xs text-stone-500 dark:text-stone-400 font-normal">
								{getMessage().EVALUATION_TYPE_THRESHOLD_DESCRIPTION}
							</p>
						</CardHeader>
						<CardContent>
							<div className="max-w-[160px]">
								<Label className="sr-only">
									{getMessage().EVALUATION_TYPE_THRESHOLD_LABEL}
								</Label>
								<Input
									type="number"
									min={0}
									max={1}
									step={0.05}
									placeholder={
										getMessage().EVALUATION_TYPE_THRESHOLD_PLACEHOLDER
									}
									value={config?.thresholdScore ?? ""}
									onChange={(e) => {
										const raw = e.target.value;
										setConfig((prev) => {
											if (!prev) return prev;
											if (raw === "") {
												return { ...prev, thresholdScore: undefined };
											}
											const nextValue = Number(raw);
											// Ignore unparseable partial input (e.g. "-", "1..2",
											// "abc") instead of propagating NaN into config and
											// on to the API — keep the last valid value until the
											// user types something parseable.
											if (Number.isNaN(nextValue)) return prev;
											return { ...prev, thresholdScore: nextValue };
										});
									}}
									onBlur={(e) => {
										const raw = e.target.value;
										if (raw === "") return;
										const parsed = Number(raw);
										if (Number.isNaN(parsed)) return;
										const clamped = Math.min(1, Math.max(0, parsed));
										if (clamped !== parsed) {
											setConfig((prev) =>
												prev ? { ...prev, thresholdScore: clamped } : prev
											);
										}
									}}
								/>
							</div>
						</CardContent>
					</Card>

					<Card className="border-stone-200 dark:border-stone-800 shadow-sm">
						<CardHeader className="pb-3">
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1">
									<CardTitle className="text-base flex items-center gap-2">
										<Switch
											checked={config?.enabled ?? false}
											onCheckedChange={handleToggle}
										/>
										Enabled
									</CardTitle>
									<p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
										When enabled, this type runs in auto and manual evaluations.
									</p>
								</div>
								<Badge
									variant={config?.enabled ? "default" : "secondary"}
									className="shrink-0"
								>
									{config?.enabled ? "Enabled" : "Disabled"}
								</Badge>
							</div>
						</CardHeader>
						{config?.enabled && (
							<CardContent className="space-y-4">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium flex items-center gap-2">
										<Link2 className="size-4 text-stone-400" />
										Rules (priority order)
									</span>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 gap-1"
										onClick={handleAddRule}
									>
										<Plus className="size-3.5" />
										Add rule
									</Button>
								</div>
								{config.rules.length === 0 ? (
									<p className="text-xs text-stone-500 dark:text-stone-400">
										No rules. Add rules to provide context for evaluation.
									</p>
								) : (
									<div className="space-y-2">
										{config.rules.map((rule, idx) => (
											<div
												key={idx}
												className="flex items-center gap-2 p-2 rounded-lg bg-stone-50 dark:bg-stone-900/50"
											>
												<Select
													value={rule.ruleId || "none"}
													onValueChange={(v) =>
														handleRuleChange(
															idx,
															v === "none" ? undefined : v
														)
													}
												>
													<SelectTrigger className="h-8 flex-1 min-w-0">
														<SelectValue placeholder="Select rule" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="none">Select rule</SelectItem>
														{(rules || []).map((r) => (
															<SelectItem key={r.id} value={r.id}>
																{r.name}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<Select
													value={String(rule.priority)}
													onValueChange={(v) =>
														handlePriorityChange(idx, parseInt(v, 10))
													}
												>
													<SelectTrigger className="h-8 w-20">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{[0, 1, 2, 3, 4, 5].map((p) => (
															<SelectItem key={p} value={String(p)}>
																P{p}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8 shrink-0 text-stone-400 hover:text-red-500"
													onClick={() => handleRemoveRule(idx)}
												>
													<Trash2 className="size-4" />
												</Button>
											</div>
										))}
									</div>
								)}
							</CardContent>
						)}
					</Card>
				</div>
				<div className="flex flex-col gap-4">
					<Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto bg-primary dark:bg-primary text-white dark:text-white hover:bg-primary/90 dark:hover:bg-primary/90">
						{isSaving ? "Saving..." : "Save Changes"}
					</Button>
					{isCustom && (
						<Button
							variant="outline"
							onClick={handleDelete}
							disabled={isDeleting}
							className="w-full sm:w-auto text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-700 dark:hover:text-red-300"
						>
							<Trash2 className="size-4 mr-1.5" />
							{isDeleting ? "Deleting..." : "Delete Custom Type"}
						</Button>
					)}
					{rulesLinkedFromRulePage.length > 0 && (
						<Card className="border-stone-200 dark:border-stone-800 shadow-sm">
							<CardHeader className="pb-2">
								<CardTitle className="text-base">Linked from rules</CardTitle>
								<p className="text-xs text-stone-500 dark:text-stone-400 font-normal">
									Rules that link to this type from the rule engine detail page
								</p>
							</CardHeader>
							<CardContent>
								<div className="flex flex-wrap gap-2">
									{rulesLinkedFromRulePage.map((rid) => {
										const r = (rules || []).find((x) => x.id === rid);
										return (
											<Link
												key={rid}
												href={`/rule-engine/${rid}`}
												className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
											>
												{r?.name || rid}
												<ExternalLink className="size-3" />
											</Link>
										);
									})}
								</div>
							</CardContent>
						</Card>
					)}
				</div>
			</div>



		</div>
	);
}
