"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import {
	CheckIcon,
	PencilIcon,
	PlusIcon,
	XIcon,
	LinkIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { Rule, RuleConditionGroup, RuleEntity } from "@/types/rule-engine";
import { Context } from "@/types/context";
import { PromptList } from "@/types/prompt";
import ConfirmationModal from "@/components/common/confirmation-modal";
import ConditionBuilder, { ConditionGroupState } from "@/components/(playground)/rule-engine/condition-builder";
import { usePageHeader } from "@/selectors/page";
import Link from "next/link";

type RuleDetail = Rule & { condition_groups?: RuleConditionGroup[] };

const ENTITY_TYPE_OPTIONS = ["context", "prompt", "dataset", "meta_config"] as const;

export default function RuleDetailPage() {
	const params = useParams();
	const ruleId = params.id as string;
	const { setHeader } = usePageHeader();

	const [isEditingInfo, setIsEditingInfo] = useState(false);
	const [editName, setEditName] = useState("");
	const [editDescription, setEditDescription] = useState("");
	const [editGroupOperator, setEditGroupOperator] = useState<"AND" | "OR">("AND");
	const [editStatus, setEditStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
	const [conditionGroups, setConditionGroups] = useState<ConditionGroupState[]>([]);
	const [newEntityType, setNewEntityType] = useState<string>("context");
	const [newEntityId, setNewEntityId] = useState("");
	const [entityOptions, setEntityOptions] = useState<{ id: string; name: string }[]>([]);
	const [isFetchingOptions, setIsFetchingOptions] = useState(false);

	const { fireRequest: fetchRuleReq, data: rule, isLoading } =
		useFetchWrapper<RuleDetail>();
	const { fireRequest: fetchEntitiesReq, data: entities } =
		useFetchWrapper<RuleEntity[]>();
	const { fireRequest: fireUpdateReq, isLoading: isUpdating } = useFetchWrapper();
	const { fireRequest: fireSaveConditions, isLoading: isSavingConditions } = useFetchWrapper();
	const { fireRequest: fireAddEntity, isLoading: isAddingEntity } = useFetchWrapper();
	const { fireRequest: fireDeleteEntity } = useFetchWrapper();
	const { fireRequest: fireEntityOptions } = useFetchWrapper();

	const fetchEntityOptions = useCallback((type: string) => {
		if (type !== "context" && type !== "prompt") {
			setEntityOptions([]);
			return;
		}
		setIsFetchingOptions(true);
		if (type === "context") {
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
		} else if (type === "prompt") {
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

	const fetchRule = useCallback(() => {
		fetchRuleReq({
			requestType: "GET",
			url: `/api/rule-engine/rules/${ruleId}`,
			successCb: (data: any) => {
				setEditName(data.name || "");
				setEditDescription(data.description || "");
				setEditGroupOperator(data.group_operator || "AND");
				setEditStatus(data.status || "ACTIVE");
				setHeader({
					title: data.name,
					breadcrumbs: [{ title: "Rule Engine", href: "/rule-engine" }],
				});
				const groups: ConditionGroupState[] = (data.condition_groups || []).map(
					(g: any) => ({
						condition_operator: g.condition_operator || "AND",
						conditions: (g.conditions || []).map((c: any) => ({
							field: c.field,
							operator: c.operator,
							value: c.value,
							data_type: c.data_type || "string",
						})),
					})
				);
				setConditionGroups(groups);
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to load rule", { id: "rule-detail" });
			},
		});
	}, [ruleId]);

	const fetchEntities = useCallback(() => {
		fetchEntitiesReq({
			requestType: "GET",
			url: `/api/rule-engine/entities?rule_id=${ruleId}`,
			failureCb: () => {},
		});
	}, [ruleId]);

	useEffect(() => {
		fetchRule();
		fetchEntities();
	}, [ruleId]);

	useEffect(() => {
		setNewEntityId("");
		fetchEntityOptions(newEntityType);
	}, [newEntityType]);

	const saveInfo = useCallback(() => {
		fireUpdateReq({
			body: JSON.stringify({
				name: editName,
				description: editDescription,
				group_operator: editGroupOperator,
				status: editStatus,
			}),
			requestType: "PUT",
			url: `/api/rule-engine/rules/${ruleId}`,
			successCb: () => {
				toast.success("Rule updated!", { id: "rule-detail" });
				setIsEditingInfo(false);
				fetchRule();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to update rule", { id: "rule-detail" });
			},
		});
	}, [ruleId, editName, editDescription, editGroupOperator, editStatus]);

	const saveConditions = useCallback(() => {
		fireSaveConditions({
			body: JSON.stringify({ condition_groups: conditionGroups }),
			requestType: "POST",
			url: `/api/rule-engine/rules/${ruleId}/conditions`,
			successCb: () => {
				toast.success("Conditions saved!", { id: "rule-conditions" });
				fetchRule();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to save conditions", { id: "rule-conditions" });
			},
		});
	}, [ruleId, conditionGroups]);

	const addEntity = useCallback(() => {
		if (!newEntityId.trim()) {
			toast.error("Entity ID is required", { id: "rule-entity" });
			return;
		}
		const alreadyLinked = ((entities as any[]) || []).some(
			(e: any) => e.entity_type === newEntityType && e.entity_id === newEntityId.trim()
		);
		if (alreadyLinked) {
			toast.error("This entity is already associated with the rule", { id: "rule-entity" });
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
				toast.success("Entity associated!", { id: "rule-entity" });
				setNewEntityId("");
				fetchEntities();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to associate entity", { id: "rule-entity" });
			},
		});
	}, [ruleId, newEntityType, newEntityId]);

	const deleteEntity = useCallback(
		({ id }: { id: string }) => {
			fireDeleteEntity({
				requestType: "DELETE",
				url: `/api/rule-engine/entities?id=${id}`,
				successCb: () => {
					toast.success("Entity removed", { id: "rule-entity" });
					fetchEntities();
				},
				failureCb: (err?: string) => {
					toast.error(err || "Failed to remove entity", { id: "rule-entity" });
				},
			});
		},
		[fetchEntities]
	);

	if (isLoading && !rule) {
		return (
			<div className="flex flex-col w-full h-full overflow-hidden gap-4 items-center justify-center">
				<div className="h-4 w-1/5 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
				<div className="h-4 w-3/5 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
				<div className="h-4 w-2/3 bg-stone-200 dark:bg-stone-700 rounded animate-pulse" />
			</div>
		);
	}

	if (!rule) return null;

	const r = rule as any;
	const entityList = (entities as any[]) || [];

	return (
		<div className="grid grid-cols-3 w-full h-full overflow-hidden gap-4">
			{/* Left: Rule info + conditions */}
			<Card className="col-span-2 overflow-hidden flex flex-col border border-stone-200 dark:border-stone-800">
				<CardHeader className="p-4 pb-3 border-b border-stone-100 dark:border-stone-800">
					<div className="flex items-start justify-between gap-4">
						{isEditingInfo ? (
							<Input
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
								className="text-lg font-semibold h-9 border-stone-300 dark:border-stone-600"
							/>
						) : (
							<div className="flex items-center gap-3">
								<CardTitle className="text-xl text-stone-900 dark:text-stone-100">
									{r.name}
								</CardTitle>
								<Badge variant={r.status === "ACTIVE" ? "default" : "secondary"}>
									{r.status}
								</Badge>
								<Badge variant="outline">{r.group_operator}</Badge>
							</div>
						)}
						<div className="flex items-center gap-2 flex-shrink-0">
							{isEditingInfo ? (
								<>
									<Button size="sm" variant="outline"
										onClick={() => {
											setIsEditingInfo(false);
											setEditName(r.name || "");
											setEditDescription(r.description || "");
											setEditGroupOperator(r.group_operator || "AND");
											setEditStatus(r.status || "ACTIVE");
										}}
										className="h-8 text-stone-600 dark:text-stone-400">
										<XIcon className="w-4 h-4 mr-1" />
										Cancel
									</Button>
									<Button size="sm" onClick={saveInfo} disabled={isUpdating}
										className={`h-8 ${isUpdating ? "animate-pulse" : ""}`}>
										<CheckIcon className="w-4 h-4 mr-1" />
										Save
									</Button>
								</>
							) : (
								<Button size="sm" variant="ghost"
									onClick={() => setIsEditingInfo(true)}
									className="h-8 text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200">
									<PencilIcon className="w-4 h-4 mr-1" />
									Edit
								</Button>
							)}
						</div>
					</div>
					{!isEditingInfo && r.created_by && (
						<p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
							Created by {r.created_by}
							{r.created_at && <> · {format(r.created_at, "MMM do, y")}</>}
						</p>
					)}
				</CardHeader>

				<CardContent className="flex flex-col gap-5 p-4 overflow-y-auto scrollbar-hidden flex-1">
					{/* Edit fields */}
					{isEditingInfo && (
						<div className="flex flex-col gap-3 p-3 rounded-md bg-stone-50 dark:bg-stone-900/50 border border-stone-200 dark:border-stone-700">
							<div className="flex flex-col gap-1">
								<label className="text-xs font-medium text-stone-500 dark:text-stone-400">
									Description
								</label>
								<Input
									value={editDescription}
									onChange={(e) => setEditDescription(e.target.value)}
									placeholder="Optional description"
									className="border-stone-300 dark:border-stone-600"
								/>
							</div>
							<div className="flex gap-3">
								<div className="flex flex-col gap-1 flex-1">
									<label className="text-xs font-medium text-stone-500 dark:text-stone-400">
										Group Operator
									</label>
									<Select value={editGroupOperator}
										onValueChange={(v) => setEditGroupOperator(v as "AND" | "OR")}>
										<SelectTrigger className="border-stone-300 dark:border-stone-600">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="AND">AND</SelectItem>
											<SelectItem value="OR">OR</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="flex flex-col gap-1 flex-1">
									<label className="text-xs font-medium text-stone-500 dark:text-stone-400">
										Status
									</label>
									<Select value={editStatus}
										onValueChange={(v) => setEditStatus(v as "ACTIVE" | "INACTIVE")}>
										<SelectTrigger className="border-stone-300 dark:border-stone-600">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="ACTIVE">Active</SelectItem>
											<SelectItem value="INACTIVE">Inactive</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
						</div>
					)}

					{!isEditingInfo && r.description && (
						<p className="text-sm text-stone-600 dark:text-stone-400">
							{r.description}
						</p>
					)}

					{/* Condition groups */}
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
								Condition Groups
							</h3>
							<Button size="sm"
								onClick={saveConditions}
								disabled={isSavingConditions}
								className={`h-7 text-xs ${isSavingConditions ? "animate-pulse" : ""}`}>
								<CheckIcon className="w-3 h-3 mr-1" />
								Save Conditions
							</Button>
						</div>
						<ConditionBuilder
							groups={conditionGroups}
							onChange={setConditionGroups}
						/>
					</div>
				</CardContent>
			</Card>

			{/* Right: Entities */}
			<Card className="flex flex-col overflow-hidden border border-stone-200 dark:border-stone-800">
				<CardHeader className="p-4 pb-3 border-b border-stone-100 dark:border-stone-800">
					<CardTitle className="text-base text-stone-800 dark:text-stone-200">
						Associated Entities
					</CardTitle>
				</CardHeader>
				<CardContent className="p-4 flex flex-col gap-4 flex-1 overflow-y-auto scrollbar-hidden">
					{/* Entity list */}
					{entityList.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-6 gap-2">
							<LinkIcon className="w-7 h-7 text-stone-300 dark:text-stone-600" />
							<p className="text-sm text-stone-400 dark:text-stone-500 text-center">
								No entities associated yet.
							</p>
						</div>
					) : (
						<div className="flex flex-col gap-2">
							{entityList.map((entity: any) => (
								<div key={entity.id}
									className="flex items-center justify-between rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/50 px-3 py-2.5">
									<div className="flex flex-col gap-1 min-w-0">
										<div className="flex items-center gap-2">
											<Badge variant="outline"
												className="text-[10px] px-1.5 py-0 h-4 border-stone-300 dark:border-stone-600 text-stone-500 dark:text-stone-400 flex-shrink-0">
												{entity.entity_type}
											</Badge>
											{entity.entity_type === "context" ? (
												<Link
													href={`/context/${entity.entity_id}`}
													className="text-sm text-stone-700 dark:text-stone-300 hover:text-primary dark:hover:text-primary truncate font-medium"
													onClick={(e) => e.stopPropagation()}
												>
													{entity.entity_id}
												</Link>
											) : entity.entity_type === "prompt" ? (
												<Link
													href={`/prompt-hub/${entity.entity_id}`}
													className="text-sm text-stone-700 dark:text-stone-300 hover:text-primary dark:hover:text-primary truncate font-medium"
													onClick={(e) => e.stopPropagation()}
												>
													{entity.entity_id}
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
										title="Remove entity association?"
										subtitle="This will remove the link between the rule and this entity."
										params={{ id: entity.id }}
									>
										<button type="button"
											className="text-stone-300 hover:text-red-500 dark:text-stone-600 dark:hover:text-red-400 transition-colors ml-2 flex-shrink-0">
											<XIcon className="w-4 h-4" />
										</button>
									</ConfirmationModal>
								</div>
							))}
						</div>
					)}

					{/* Add entity form */}
					<div className="flex flex-col gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
						<p className="text-xs font-medium text-stone-500 dark:text-stone-400">
							Associate New Entity
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
						{newEntityType === "context" || newEntityType === "prompt" ? (
							<Select
								value={newEntityId}
								onValueChange={setNewEntityId}
								disabled={isFetchingOptions}
							>
								<SelectTrigger className="h-8 text-sm border-stone-300 dark:border-stone-600">
									<SelectValue
										placeholder={
											isFetchingOptions
												? "Loading..."
												: `Select ${newEntityType}`
										}
									/>
								</SelectTrigger>
								<SelectContent>
									{(() => {
										const linkedIds = new Set(
											((entities as any[]) || [])
												.filter((e: any) => e.entity_type === newEntityType)
												.map((e: any) => e.entity_id)
										);
										const available = entityOptions.filter((o) => !linkedIds.has(o.id));
										if (available.length === 0 && !isFetchingOptions) {
											return (
												<div className="px-2 py-3 text-xs text-stone-400 text-center">
													No unlinked {newEntityType}s found
												</div>
											);
										}
										return available.map((opt) => (
											<SelectItem key={opt.id} value={opt.id}>
												{opt.name}
											</SelectItem>
										));
									})()}
								</SelectContent>
							</Select>
						) : (
							<Input
								className="h-8 text-sm border-stone-300 dark:border-stone-600"
								placeholder="Entity ID"
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
							Associate
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
