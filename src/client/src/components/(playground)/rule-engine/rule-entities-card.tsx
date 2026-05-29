"use client";
import { useCallback, useEffect, useState } from "react";
import { LinkIcon, PlusIcon, XIcon, Layers } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import ConfirmationModal from "@/components/common/confirmation-modal";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { RuleEntity } from "@/types/rule-engine";
import { Context } from "@/types/context";
import { PromptList } from "@/types/prompt";
import getMessage from "@/constants/messages";
import { EVALUATION_TYPES } from "@/constants/evaluation-types";

const ENTITY_TYPE_OPTIONS = [
	"context",
	"prompt",
	// "dataset",
	// "meta_config",
	"evaluation",
] as const;

export default function RuleEntitiesCard({ ruleId }: { ruleId: string }) {
	const messages = getMessage();
	const [entities, setEntities] = useState<RuleEntity[]>([]);
	const [entityTitles, setEntityTitles] = useState<Record<string, string>>({});
	const [newEntityType, setNewEntityType] = useState<string>("context");
	const [newEntityId, setNewEntityId] = useState("");
	const [entityOptions, setEntityOptions] = useState<{ id: string; name: string }[]>([]);
	const [isFetchingOptions, setIsFetchingOptions] = useState(false);
	const [evalTypesFromConfig, setEvalTypesFromConfig] = useState<
		Array<{ id: string; rules?: Array<{ ruleId: string }> }>
	>([]);

	const { fireRequest: fetchEntitiesReq } = useFetchWrapper();
	const { fireRequest: fetchEvalTypes } = useFetchWrapper();
	const { fireRequest: fireAddEntity, isLoading: isAddingEntity } = useFetchWrapper();
	const { fireRequest: fireDeleteEntity } = useFetchWrapper();
	const { fireRequest: fireEntityOptions } = useFetchWrapper();
	const { fireRequest: fetchContextTitle } = useFetchWrapper();
	const { fireRequest: fetchPromptTitle } = useFetchWrapper();

	const fetchEntityTitle = useCallback(
		(entityType: string, entityId: string) => {
			if (entityType === "context") {
				fetchContextTitle({
					requestType: "GET",
					url: `/api/context/${entityId}`,
					successCb: (data: any) => {
						const ctx = Array.isArray(data) ? data[0] : data;
						if (ctx?.name) {
							setEntityTitles((prev) => ({
								...prev,
								[`${entityType}:${entityId}`]: ctx.name,
							}));
						}
					},
					failureCb: () => {},
				});
			} else if (entityType === "prompt") {
				fetchPromptTitle({
					requestType: "GET",
					url: `/api/prompt/get/${entityId}`,
					responseDataKey: "data.[0]",
					successCb: (data: any) => {
						if (data?.name) {
							setEntityTitles((prev) => ({
								...prev,
								[`${entityType}:${entityId}`]: data.name,
							}));
						}
					},
					failureCb: () => {},
				});
			} else if (entityType === "evaluation") {
				const et = EVALUATION_TYPES.find((e) => e.id === entityId);
				if (et) {
					setEntityTitles((prev) => ({
						...prev,
						[`${entityType}:${entityId}`]: et.label,
					}));
				}
			}
		},
		[]
	);

	const fetchEntities = useCallback(() => {
		fetchEntitiesReq({
			requestType: "GET",
			url: `/api/rule-engine/entities?rule_id=${ruleId}`,
			successCb: (data: any) => {
				const list = Array.isArray(data) ? data : [];
				setEntities(list);
				list.forEach((entity: any) => {
					if (
						entity.entity_type === "context" ||
						entity.entity_type === "prompt" ||
						entity.entity_type === "evaluation"
					) {
						fetchEntityTitle(entity.entity_type, entity.entity_id);
					}
				});
			},
			failureCb: () => {},
		});
	}, [ruleId, fetchEntityTitle]);

	const fetchEntityOptions = useCallback((type: string) => {
		if (type !== "context" && type !== "prompt" && type !== "evaluation") {
			setEntityOptions([]);
			return;
		}
		setIsFetchingOptions(true);
		if (type === "evaluation") {
			// Built-in types from constants
			const builtInOptions = EVALUATION_TYPES.map((e) => ({ id: e.id, name: e.label }));
			// Also fetch custom types from API
			fireEntityOptions({
				requestType: "GET",
				url: "/api/evaluation/types",
				responseDataKey: "data",
				successCb: (data: any) => {
					const apiTypes = Array.isArray(data) ? data : [];
					const builtInIds = new Set(EVALUATION_TYPES.map((e) => e.id));
					const customOptions = apiTypes
						.filter((t: any) => t.isCustom && !builtInIds.has(t.id))
						.map((t: any) => ({ id: t.id, name: t.label || t.id }));
					setEntityOptions([...builtInOptions, ...customOptions]);
					setIsFetchingOptions(false);
				},
				failureCb: () => {
					setEntityOptions(builtInOptions);
					setIsFetchingOptions(false);
				},
			});
		} else if (type === "context") {
			fireEntityOptions({
				requestType: "GET",
				url: "/api/context",
				successCb: (data: any) => {
					const list: Context[] = Array.isArray(data) ? data : [];
					setEntityOptions(list.map((c) => ({ id: c.id, name: c.name })));
					setIsFetchingOptions(false);
				},
				failureCb: () => setIsFetchingOptions(false),
			});
		} else {
			fireEntityOptions({
				requestType: "POST",
				url: "/api/prompt/get",
				successCb: (data: any) => {
					const list: PromptList[] = Array.isArray(data) ? data : [];
					setEntityOptions(list.map((p) => ({ id: p.promptId, name: p.name })));
					setIsFetchingOptions(false);
				},
				failureCb: () => setIsFetchingOptions(false),
			});
		}
	}, []);

	useEffect(() => {
		fetchEntities();
	}, [ruleId]);

	useEffect(() => {
		fetchEvalTypes({
			requestType: "GET",
			url: "/api/evaluation/types",
			successCb: (data: any) => {
				const types = data?.data ?? [];
				setEvalTypesFromConfig(Array.isArray(types) ? types : []);
			},
			failureCb: () => setEvalTypesFromConfig([]),
		});
	}, [ruleId]);

	useEffect(() => {
		setNewEntityId("");
		fetchEntityOptions(newEntityType);
	}, [newEntityType]);

	const addEntity = useCallback(() => {
		if (!newEntityId.trim()) {
			toast.error(messages.RULE_ENTITY_ID_REQUIRED, { id: "rule-entity" });
			return;
		}
		const alreadyLinked = entities.some(
			(e: any) =>
				e.entity_type === newEntityType && e.entity_id === newEntityId.trim()
		);
		if (alreadyLinked) {
			toast.error(messages.RULE_ENTITY_ALREADY_ASSOCIATED, {
				id: "rule-entity",
			});
			return;
		}
		fireAddEntity({
			body: JSON.stringify({
				rule_id: ruleId,
				entity_type: newEntityType,
				entity_id: newEntityId.trim(),
			}),
			requestType: "POST",
			url: "/api/rule-engine/entities",
			successCb: () => {
				toast.success(messages.RULE_ENTITY_ASSOCIATED, { id: "rule-entity" });
				setNewEntityId("");
				fetchEntities();
				if (
					newEntityType === "context" ||
					newEntityType === "prompt" ||
					newEntityType === "evaluation"
				) {
					fetchEntityTitle(newEntityType, newEntityId.trim());
				}
			},
			failureCb: (err?: string) => {
				toast.error(err || messages.RULE_ENTITY_ASSOCIATE_FAILED, {
					id: "rule-entity",
				});
			},
		});
	}, [ruleId, newEntityType, newEntityId, entities, fetchEntities, fetchEntityTitle]);

	const deleteEntity = useCallback(
		({ id }: { id: string }) => {
			fireDeleteEntity({
				requestType: "DELETE",
				url: `/api/rule-engine/entities?id=${id}`,
				successCb: () => {
					toast.success(messages.RULE_ENTITY_REMOVED, { id: "rule-entity" });
					fetchEntities();
				},
				failureCb: (err?: string) => {
					toast.error(err || messages.RULE_ENTITY_REMOVE_FAILED, {
						id: "rule-entity",
					});
				},
			});
		},
		[fetchEntities]
	);

	const linkedIds = new Set(
		entities
			.filter((e: any) => e.entity_type === newEntityType)
			.map((e: any) => e.entity_id)
	);
	const availableOptions = entityOptions.filter((o) => !linkedIds.has(o.id));

	const evaluationEntities = entities.filter(
		(e: any) => e.entity_type === "evaluation"
	);
	// Evaluation types that reference this rule from the Evaluation Types page config
	const evalTypeIdsFromConfig = evalTypesFromConfig
		.filter((t) =>
			t.rules?.some((r) => r.ruleId === ruleId)
		)
		.map((t) => t.id);
	// Merge: from rule entities + from config (dedupe by id)
	const allEvalTypeIds = Array.from(
		new Set([
			...evaluationEntities.map((e: any) => e.entity_id),
			...evalTypeIdsFromConfig,
		])
	);
	const otherEntities = entities.filter(
		(e: any) => e.entity_type !== "evaluation"
	);

	return (
		<Card className="flex flex-col overflow-hidden border border-stone-200 dark:border-stone-800 basis-1/2">
			<CardHeader className="p-4 pb-3 border-b border-stone-100 dark:border-stone-800">
				<CardTitle className="text-base text-stone-800 dark:text-stone-200">
					{messages.RULE_ASSOCIATED_ENTITIES}
				</CardTitle>
			</CardHeader>
			<CardContent className="p-4 flex flex-col gap-4 flex-1 overflow-y-auto scrollbar-hidden">
				{/* Evaluation types section: from rule entities + from Evaluation Types page config */}
				{allEvalTypeIds.length > 0 && (
					<div className="flex flex-col gap-2">
						<p className="text-xs font-medium text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
							<Layers className="size-3.5" />
							Evaluation types
						</p>
						<div className="flex flex-wrap gap-1.5">
							{allEvalTypeIds.map((evalTypeId) => {
								const entity = evaluationEntities.find(
									(e: any) => e.entity_id === evalTypeId
								);
								const label =
									entityTitles[`evaluation:${evalTypeId}`] ||
									EVALUATION_TYPES.find((e) => e.id === evalTypeId)?.label ||
									evalTypeId;
								const fromConfig = !entity && evalTypeIdsFromConfig.includes(evalTypeId);
								return (
									<div
										key={evalTypeId}
										className="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/50 px-2.5 py-1.5 group"
									>
										<Link
											href="/evaluations/types"
											className="text-sm text-stone-700 dark:text-stone-300 hover:text-primary dark:hover:text-primary transition-colors"
											onClick={(e) => e.stopPropagation()}
										>
											{label}
										</Link>
										{fromConfig && (
											<span className="text-[10px] text-stone-400 dark:text-stone-500">
												(from config)
											</span>
										)}
										{entity && (
											<ConfirmationModal
												handleYes={deleteEntity}
												title={messages.RULE_REMOVE_ENTITY_TITLE}
												subtitle={messages.RULE_REMOVE_ENTITY_SUBTITLE}
												params={{ id: entity.id }}
											>
												<button
													type="button"
													className="text-stone-300 hover:text-red-500 dark:text-stone-600 dark:hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
												>
													<XIcon className="w-3.5 h-3.5" />
												</button>
											</ConfirmationModal>
										)}
									</div>
								);
							})}
						</div>
					</div>
				)}

				{/* Entity list */}
				{entities.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-6 gap-2">
						<LinkIcon className="w-7 h-7 text-stone-300 dark:text-stone-600" />
						<p className="text-sm text-stone-400 dark:text-stone-500 text-center">
							{messages.RULE_NO_ENTITIES}
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						{otherEntities.length > 0 && (
							<>
								<p className="text-xs font-medium text-stone-500 dark:text-stone-400">
									Other entities
								</p>
								{otherEntities.map((entity: any) => (
							<div
								key={entity.id}
								className="flex items-center justify-between rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/50 px-3 py-2.5"
							>
								<div className="flex flex-col gap-1 min-w-0">
									<div className="flex items-center gap-2">
										<Badge
											variant="outline"
											className="text-[10px] px-1.5 py-0 h-4 border-stone-300 dark:border-stone-600 text-stone-500 dark:text-stone-400 flex-shrink-0"
										>
											{entity.entity_type}
										</Badge>
										{entity.entity_type === "context" ? (
											<Link
												href={`/context/${entity.entity_id}`}
												className="text-sm text-stone-700 dark:text-stone-300 hover:text-primary dark:hover:text-primary truncate font-medium"
												onClick={(e) => e.stopPropagation()}
											>
												{entityTitles[
													`${entity.entity_type}:${entity.entity_id}`
												] || entity.entity_id}
											</Link>
										) : entity.entity_type === "prompt" ? (
											<Link
												href={`/prompt-hub/${entity.entity_id}`}
												className="text-sm text-stone-700 dark:text-stone-300 hover:text-primary dark:hover:text-primary truncate font-medium"
												onClick={(e) => e.stopPropagation()}
											>
												{entityTitles[
													`${entity.entity_type}:${entity.entity_id}`
												] || entity.entity_id}
											</Link>
										) : entity.entity_type === "evaluation" ? (
											<Link
												href="/evaluations/types"
												className="text-sm text-stone-700 dark:text-stone-300 hover:text-primary dark:hover:text-primary truncate font-medium"
												onClick={(e) => e.stopPropagation()}
											>
												{entityTitles[
													`${entity.entity_type}:${entity.entity_id}`
												] || entity.entity_id}
											</Link>
										) : (
											<span className="font-mono text-xs text-stone-700 dark:text-stone-300 truncate">
												{entity.entity_id}
											</span>
										)}
									</div>
									{entity.created_by && (
										<span className="text-[11px] text-stone-400 dark:text-stone-500">
											by {entity.created_by}
										</span>
									)}
								</div>
								<ConfirmationModal
									handleYes={deleteEntity}
									title={messages.RULE_REMOVE_ENTITY_TITLE}
									subtitle={messages.RULE_REMOVE_ENTITY_SUBTITLE}
									params={{ id: entity.id }}
								>
									<button
										type="button"
										className="text-stone-300 hover:text-red-500 dark:text-stone-600 dark:hover:text-red-400 transition-colors ml-2 flex-shrink-0"
									>
										<XIcon className="w-4 h-4" />
									</button>
								</ConfirmationModal>
							</div>
						))}
							</>
						)}
					</div>
				)}

				{/* Add entity form */}
				<div className="flex flex-col gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
					<p className="text-xs font-medium text-stone-500 dark:text-stone-400">
						{messages.RULE_ASSOCIATE_NEW_ENTITY}
					</p>
					<Select value={newEntityType} onValueChange={setNewEntityType}>
						<SelectTrigger className="h-8 text-sm border-stone-300 dark:border-stone-600">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{ENTITY_TYPE_OPTIONS.map((t) => (
								<SelectItem key={t} value={t}>
									{t}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					{newEntityType === "context" ||
					newEntityType === "prompt" ||
					newEntityType === "evaluation" ? (
						<Select
							value={newEntityId}
							onValueChange={setNewEntityId}
							disabled={isFetchingOptions}
						>
							<SelectTrigger className="h-8 text-sm border-stone-300 dark:border-stone-600">
								<SelectValue
									placeholder={
										isFetchingOptions
											? messages.LOADING
											: `${messages.SELECT} ${newEntityType}`
									}
								/>
							</SelectTrigger>
							<SelectContent>
								{availableOptions.length === 0 && !isFetchingOptions ? (
									<div className="px-2 py-3 text-xs text-stone-400 text-center">
										No unlinked {newEntityType}s found
									</div>
								) : (
									availableOptions.map((opt) => (
										<SelectItem key={opt.id} value={opt.id}>
											{opt.name}
										</SelectItem>
									))
								)}
							</SelectContent>
						</Select>
					) : (
						<Input
							className="h-8 text-sm border-stone-300 dark:border-stone-600"
							placeholder={messages.RULE_ENTITY_ID_REQUIRED}
							value={newEntityId}
							onChange={(e) => setNewEntityId(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									addEntity();
								}
							}}
						/>
					)}

					<Button
						size="sm"
						variant="outline"
						type="button"
						onClick={addEntity}
						disabled={isAddingEntity}
						className={`border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-400 ${isAddingEntity ? "animate-pulse" : ""}`}
					>
						<PlusIcon className="w-3 h-3 mr-1" />
						{messages.RULE_ASSOCIATE}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
