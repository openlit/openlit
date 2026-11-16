"use client";

import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import IntermediateState from "@/components/(playground)/intermediate-state";
import ConfirmationModal from "@/components/common/confirmation-modal";
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

const EVALUATORS_HREF = "/evaluations?tab=evaluators";

export default function EvaluationTypeDetailPage() {
	const m = getMessage();
	const posthog = usePostHog();
	const params = useParams();
	const router = useRouter();
	const typeId = params.id as string;
	const et = EVALUATION_TYPES.find((e) => e.id === typeId);

	const [config, setConfig] = useState<EvaluationTypeConfig | null>(null);
	const [notFound, setNotFound] = useState(false);
	/** Type id whose GET has completed; guards against stale responses. */
	const [loadedTypeId, setLoadedTypeId] = useState<string | null>(null);
	const {
		fireRequest: getType,
		data: typeResponse,
		error: typeError,
		isLoading: typeLoading,
	} =
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
	// Only reserve a side column when there is something to show in it.
	const hasLinkedRules = rulesLinkedFromRulePage.length > 0;

	useEffect(() => {
		setNotFound(false);
		setConfig(null);
		posthog?.capture(CLIENT_EVENTS.EVALUATION_TYPE_EDIT_PAGE_VISITED);
		getType({
			requestType: "GET",
			url: `/api/evaluation/types/${encodeURIComponent(typeId)}`,
			responseDataKey: "data",
			successCb: () => setLoadedTypeId(typeId),
			failureCb: () => setLoadedTypeId(typeId),
		});
		getRules({ requestType: "GET", url: "/api/rule-engine/rules" });
		getEvalEntities({
			requestType: "GET",
			url: "/api/rule-engine/entities?entity_type=evaluation",
		});
	}, [typeId]);

	useEffect(() => {
		const res = typeResponse as { data?: EvaluationTypeConfig } | undefined;
		const response = res?.data ?? (typeResponse as EvaluationTypeConfig | undefined);
		// Ignore a response left over from the previously viewed type: saving
		// it would PATCH this type with another type's settings.
		const data = response?.id === typeId ? response : undefined;
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

		if (loadedTypeId === typeId && (typeError || !data?.id)) {
			setNotFound(true);
		}
	}, [typeResponse, et, loadedTypeId, typeError, typeId]);

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
				toast.success(m.EVALUATION_TYPE_UPDATED);
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
			failureCb: (err?: string) => toast.error(err || m.EVALUATION_TYPE_SAVE_FAILED),
		});
	};

	const handleDelete = () => {
		deleteType({
			requestType: "DELETE",
			url: `/api/evaluation/types/${typeId}`,
			responseDataKey: "data",
			successCb: () => {
				toast.success(m.EVALUATION_TYPE_DELETED);
				router.push(EVALUATORS_HREF);
			},
			failureCb: (err?: string) => toast.error(err || m.EVALUATION_TYPE_DELETE_FAILED),
		});
	};

	// Derive display label/description from built-in constant or custom type from API
	const isCustom = !et && config?.isCustom;
	const displayLabel = et?.label || config?.label || typeId;
	const displayDescription = et?.description || config?.description || "";
	const canEdit =
		config?.id === typeId && !notFound && loadedTypeId === typeId && !typeLoading;

	const backLabel = m.EVALUATION_BACK_TO_TYPES;

	const header = (
		<FeaturePageHeader
			eyebrow={m.FEATURE_EVALS}
			title={displayLabel}
			icon={<Layers className="h-4 w-4" />}
			tone="border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/40 dark:text-orange-300"
			leading={
				<Button
					asChild
					variant="outline"
					size="sm"
					className="h-8 w-8 shrink-0 p-0"
				>
					<Link href={EVALUATORS_HREF} title={backLabel} aria-label={backLabel}>
						<ArrowLeft className="h-3.5 w-3.5" />
					</Link>
				</Button>
			}
			actions={
				canEdit ? (
					<>
						{isCustom ? (
							<Badge variant="outline" className="h-8 gap-1 border-primary/30 text-primary">
								<Sparkles className="size-3" />
								{m.EVALUATION_TYPE_CUSTOM_BADGE}
							</Badge>
						) : null}
						{isCustom ? (
							<ConfirmationModal
								title={m.EVALUATION_TYPE_DELETE_CUSTOM}
								subtitle={m.EVALUATION_TYPE_DELETE_CONFIRM(displayLabel)}
								handleYes={handleDelete}
							>
								<Button
									variant="outline"
									size="sm"
									disabled={isDeleting}
									className={`h-8 gap-1.5 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 ${isDeleting ? "animate-pulse" : ""}`}
								>
									<Trash2 className="size-3.5" />
									{isDeleting ? m.EVALUATION_TYPE_DELETING : m.EVALUATION_TYPE_DELETE_CUSTOM}
								</Button>
							</ConfirmationModal>
						) : null}
						<Button
							onClick={handleSave}
							disabled={isSaving}
							size="sm"
							className={`h-8 ${isSaving ? "animate-pulse" : ""}`}
						>
							{isSaving ? m.EVALUATION_SAVING : m.EVALUATION_SAVE_CHANGES}
						</Button>
					</>
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
						{m.EVALUATION_TYPE_NOT_FOUND}
					</p>
					<p className="max-w-md text-sm text-stone-500 dark:text-stone-400">
						{m.EVALUATION_TYPE_NOT_FOUND_DESCRIPTION}
					</p>
					<Button asChild variant="outline" size="sm" className="h-8">
						<Link href={EVALUATORS_HREF}>
							{m.EVALUATION_BACK_TO_TYPES}
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
				<IntermediateState type="loading" classNames="flex-1" />
			</div>
		);
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			{header}

			<div
				className={`grid flex-1 grid-cols-1 content-start gap-4 overflow-auto p-4 ${
					hasLinkedRules ? "lg:grid-cols-3" : ""
				}`}
			>
				<div
					className={`flex flex-col gap-4 ${hasLinkedRules ? "lg:col-span-2" : ""}`}
				>
					<Card className="border border-stone-200 dark:border-stone-800">
						<CardHeader className="p-4">
							<CardTitle className="text-sm font-medium text-stone-700 dark:text-stone-300">
								{m.EVALUATION_TYPE_PURPOSE_TITLE}
							</CardTitle>
							<p className="text-sm font-normal text-stone-500 dark:text-stone-400">
								{displayDescription}
							</p>
						</CardHeader>
					</Card>

					{(config?.defaultPrompt || config?.prompt !== undefined) && (
						<Card className="border border-stone-200 dark:border-stone-800">
							<CardHeader className="p-4 pb-2">
								<CardTitle className="text-sm font-medium text-stone-700 dark:text-stone-300">
									{m.EVALUATION_TYPE_PROMPT_CONTEXT_TITLE}
								</CardTitle>
								<p className="text-xs font-normal text-stone-500 dark:text-stone-400">
									{m.EVALUATION_TYPE_PROMPT_CONTEXT_HELP}
								</p>
							</CardHeader>
							<CardContent className="p-4 pt-0">
								<Textarea
									aria-label={m.EVALUATION_TYPE_PROMPT_CONTEXT_TITLE}
									className="min-h-[120px] resize-y font-mono text-xs"
									value={
										config?.prompt ?? config?.defaultPrompt ?? ""
									}
									onChange={(e) =>
										setConfig((prev) =>
											prev ? { ...prev, prompt: e.target.value } : null
										)
									}
									placeholder={m.EVALUATION_TYPE_PROMPT_CONTEXT_PLACEHOLDER}
								/>
							</CardContent>
						</Card>
					)}

					<Card className="border border-stone-200 dark:border-stone-800">
						<CardHeader className="p-4 pb-2">
							<CardTitle className="text-sm font-medium text-stone-700 dark:text-stone-300">
								{m.EVALUATION_TYPE_THRESHOLD_LABEL}
							</CardTitle>
							<p className="text-xs font-normal text-stone-500 dark:text-stone-400">
								{m.EVALUATION_TYPE_THRESHOLD_DESCRIPTION}
							</p>
						</CardHeader>
						<CardContent className="p-4 pt-0">
							<div className="max-w-[160px]">
								<Label className="sr-only">
									{m.EVALUATION_TYPE_THRESHOLD_LABEL}
								</Label>
								<Input
									type="number"
									min={0}
									max={1}
									step={0.05}
									placeholder={m.EVALUATION_TYPE_THRESHOLD_PLACEHOLDER}
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

					<Card className="border border-stone-200 dark:border-stone-800">
						<CardHeader
							className={`p-4 ${config?.enabled ? "pb-3 border-b border-stone-100 dark:border-stone-800" : ""}`}
						>
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1">
									<CardTitle className="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
										<Switch
											checked={config?.enabled ?? false}
											onCheckedChange={handleToggle}
											aria-label={m.EVALUATION_TYPE_ENABLED}
										/>
										{m.EVALUATION_TYPE_ENABLED}
									</CardTitle>
									<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
										{m.EVALUATION_TYPE_ENABLED_HELP}
									</p>
								</div>
								<Badge
									variant={config?.enabled ? "default" : "secondary"}
									className="shrink-0"
								>
									{config?.enabled ? m.EVALUATION_TYPE_ENABLED : m.EVALUATION_TYPE_DISABLED}
								</Badge>
							</div>
						</CardHeader>
						{config?.enabled && (
							<CardContent className="flex flex-col gap-4 p-4">
								<div className="flex items-center justify-between">
									<span className="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
										<Link2 className="size-4 text-stone-400" />
										{m.EVALUATION_TYPE_RULES_TITLE}
									</span>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 gap-1"
										onClick={handleAddRule}
									>
										<Plus className="size-3.5" />
										{m.EVALUATION_TYPE_ADD_RULE}
									</Button>
								</div>
								{config.rules.length === 0 ? (
									<p className="text-xs text-stone-500 dark:text-stone-400">
										{m.EVALUATION_TYPE_NO_RULES}
									</p>
								) : (
									<div className="flex flex-col gap-2">
										{config.rules.map((rule, idx) => (
											<div
												key={idx}
												className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 p-2 dark:border-stone-800 dark:bg-stone-900/50"
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
														<SelectValue placeholder={m.EVALUATION_TYPE_SELECT_RULE} />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="none">{m.EVALUATION_TYPE_SELECT_RULE}</SelectItem>
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
																{m.EVALUATION_TYPE_PRIORITY_OPTION(p)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8 shrink-0 text-stone-400 hover:text-red-500 dark:hover:text-red-400"
													onClick={() => handleRemoveRule(idx)}
													title={m.EVALUATION_TYPE_REMOVE_RULE}
													aria-label={m.EVALUATION_TYPE_REMOVE_RULE}
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
				{hasLinkedRules && (
					<div className="flex flex-col gap-4">
						<Card className="border border-stone-200 dark:border-stone-800">
							<CardHeader className="p-4 pb-2">
								<CardTitle className="text-sm font-medium text-stone-700 dark:text-stone-300">
									{m.EVALUATION_TYPE_LINKED_RULES_TITLE}
								</CardTitle>
								<p className="text-xs font-normal text-stone-500 dark:text-stone-400">
									{m.EVALUATION_TYPE_LINKED_RULES_DESCRIPTION}
								</p>
							</CardHeader>
							<CardContent className="p-4 pt-0">
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
					</div>
				)}
			</div>
		</div>
	);
}
