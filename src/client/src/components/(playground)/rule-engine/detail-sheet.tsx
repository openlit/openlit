"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PencilIcon, PlusIcon, TrashIcon, XIcon } from "lucide-react";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
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
import ConfirmationModal from "@/components/common/confirmation-modal";
import ConditionBuilder from "./condition-builder";
import { Rule, RuleConditionGroup, RuleEntity } from "@/types/rule-engine";

type RuleDetail = Rule & { condition_groups?: RuleConditionGroup[] };

type ConditionGroupState = {
	condition_operator: "AND" | "OR";
	conditions: Array<{
		field: string;
		operator: string;
		value: string;
		data_type: string;
	}>;
};

export default function RuleDetailSheet({
	ruleId,
	open,
	onOpenChange,
	onUpdate,
}: {
	ruleId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUpdate?: () => void;
}) {
	const [rule, setRule] = useState<RuleDetail | null>(null);
	const [entities, setEntities] = useState<RuleEntity[]>([]);
	const [isEditingInfo, setIsEditingInfo] = useState(false);
	const [editName, setEditName] = useState("");
	const [editDescription, setEditDescription] = useState("");
	const [editGroupOperator, setEditGroupOperator] = useState<"AND" | "OR">(
		"AND"
	);
	const [editStatus, setEditStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
	const [conditionGroups, setConditionGroups] = useState<
		ConditionGroupState[]
	>([]);
	const [newEntityType, setNewEntityType] = useState("context");
	const [newEntityId, setNewEntityId] = useState("");

	const { fireRequest: fetchRule, isLoading: isLoadingRule } =
		useFetchWrapper<RuleDetail>();
	const { fireRequest: fetchEntities, isLoading: isLoadingEntities } =
		useFetchWrapper<RuleEntity[]>();
	const { fireRequest: fireUpdateRequest, isLoading: isUpdating } =
		useFetchWrapper();
	const { fireRequest: fireSaveConditions, isLoading: isSavingConditions } =
		useFetchWrapper();
	const { fireRequest: fireAddEntity, isLoading: isAddingEntity } =
		useFetchWrapper();
	const { fireRequest: fireDeleteEntity } = useFetchWrapper();

	const loadRule = useCallback(() => {
		if (!ruleId) return;
		fetchRule({
			requestType: "GET",
			url: `/api/rule-engine/rules/${ruleId}`,
			successCb: (data: any) => {
				setRule(data);
				setEditName(data.name || "");
				setEditDescription(data.description || "");
				setEditGroupOperator(data.group_operator || "AND");
				setEditStatus(data.status || "ACTIVE");

				const groups: ConditionGroupState[] = (
					data.condition_groups || []
				).map((g: any) => ({
					condition_operator: g.condition_operator || "AND",
					conditions: (g.conditions || []).map((c: any) => ({
						field: c.field,
						operator: c.operator,
						value: c.value,
						data_type: c.data_type || "string",
					})),
				}));
				setConditionGroups(groups);
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to load rule", { id: "rule-detail" });
			},
		});
	}, [ruleId]);

	const loadEntities = useCallback(() => {
		if (!ruleId) return;
		fetchEntities({
			requestType: "GET",
			url: `/api/rule-engine/entities?rule_id=${ruleId}`,
			successCb: (data: any) => {
				setEntities(data || []);
			},
			failureCb: () => {},
		});
	}, [ruleId]);

	useEffect(() => {
		if (open && ruleId) {
			loadRule();
			loadEntities();
		}
	}, [open, ruleId]);

	const saveInfo = useCallback(() => {
		if (!ruleId) return;
		fireUpdateRequest({
			body: JSON.stringify({
				name: editName,
				description: editDescription,
				group_operator: editGroupOperator,
				status: editStatus,
			}),
			requestType: "PUT",
			url: `/api/rule-engine/rules/${ruleId}`,
			successCb: () => {
				toast.success("Rule updated successfully!", { id: "rule-detail" });
				setIsEditingInfo(false);
				loadRule();
				if (typeof onUpdate === "function") onUpdate();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to update rule", { id: "rule-detail" });
			},
		});
	}, [ruleId, editName, editDescription, editGroupOperator, editStatus]);

	const saveConditions = useCallback(() => {
		if (!ruleId) return;
		fireSaveConditions({
			body: JSON.stringify({ condition_groups: conditionGroups }),
			requestType: "POST",
			url: `/api/rule-engine/rules/${ruleId}/conditions`,
			successCb: () => {
				toast.success("Conditions saved successfully!", {
					id: "rule-conditions",
				});
				loadRule();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to save conditions", {
					id: "rule-conditions",
				});
			},
		});
	}, [ruleId, conditionGroups]);

	const addEntity = useCallback(() => {
		if (!ruleId || !newEntityId.trim()) {
			toast.error("Entity ID is required", { id: "rule-entity" });
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
				toast.success("Entity associated successfully!", {
					id: "rule-entity",
				});
				setNewEntityId("");
				loadEntities();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Failed to associate entity", {
					id: "rule-entity",
				});
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
					loadEntities();
				},
				failureCb: (err?: string) => {
					toast.error(err || "Failed to remove entity", {
						id: "rule-entity",
					});
				},
			});
		},
		[loadEntities]
	);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				className="max-w-2xl w-full overflow-y-auto"
				side="right"
			>
				{isLoadingRule && !rule ? (
					<div className="flex items-center justify-center h-full">
						<p className="text-stone-500 dark:text-stone-400 animate-pulse">
							Loading...
						</p>
					</div>
				) : rule ? (
					<div className="flex flex-col gap-6 pt-2">
						{/* Section 1: Rule Info */}
						<div className="flex flex-col gap-3">
							<div className="flex items-center justify-between">
								<SheetTitle className="text-base font-semibold text-stone-800 dark:text-stone-200">
									Rule Info
								</SheetTitle>
								{!isEditingInfo ? (
									<button
										type="button"
										onClick={() => setIsEditingInfo(true)}
										className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
									>
										<PencilIcon className="w-4 h-4" />
									</button>
								) : (
									<div className="flex gap-2">
										<Button
											size="sm"
											variant="outline"
											onClick={() => setIsEditingInfo(false)}
										>
											Cancel
										</Button>
										<Button
											size="sm"
											onClick={saveInfo}
											disabled={isUpdating}
											className={isUpdating ? "animate-pulse" : ""}
										>
											Save
										</Button>
									</div>
								)}
							</div>

							{isEditingInfo ? (
								<div className="flex flex-col gap-3">
									<div className="flex flex-col gap-1">
										<label className="text-xs text-stone-500 dark:text-stone-400">
											Name
										</label>
										<Input
											value={editName}
											onChange={(e) => setEditName(e.target.value)}
											className="h-8 text-sm"
										/>
									</div>
									<div className="flex flex-col gap-1">
										<label className="text-xs text-stone-500 dark:text-stone-400">
											Description
										</label>
										<Input
											value={editDescription}
											onChange={(e) => setEditDescription(e.target.value)}
											className="h-8 text-sm"
										/>
									</div>
									<div className="flex gap-3">
										<div className="flex flex-col gap-1 flex-1">
											<label className="text-xs text-stone-500 dark:text-stone-400">
												Group Operator
											</label>
											<Select
												value={editGroupOperator}
												onValueChange={(v) =>
													setEditGroupOperator(v as "AND" | "OR")
												}
											>
												<SelectTrigger className="h-8 text-sm">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="AND">AND</SelectItem>
													<SelectItem value="OR">OR</SelectItem>
												</SelectContent>
											</Select>
										</div>
										<div className="flex flex-col gap-1 flex-1">
											<label className="text-xs text-stone-500 dark:text-stone-400">
												Status
											</label>
											<Select
												value={editStatus}
												onValueChange={(v) =>
													setEditStatus(v as "ACTIVE" | "INACTIVE")
												}
											>
												<SelectTrigger className="h-8 text-sm">
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
							) : (
								<div className="flex flex-col gap-2 text-sm">
									<div className="flex gap-2">
										<span className="text-stone-500 dark:text-stone-400 w-28 flex-shrink-0">
											Name
										</span>
										<span className="text-stone-800 dark:text-stone-200 font-medium">
											{rule.name}
										</span>
									</div>
									{rule.description && (
										<div className="flex gap-2">
											<span className="text-stone-500 dark:text-stone-400 w-28 flex-shrink-0">
												Description
											</span>
											<span className="text-stone-700 dark:text-stone-300">
												{rule.description}
											</span>
										</div>
									)}
									<div className="flex gap-2">
										<span className="text-stone-500 dark:text-stone-400 w-28 flex-shrink-0">
											Group Operator
										</span>
										<Badge variant="outline">{rule.group_operator}</Badge>
									</div>
									<div className="flex gap-2">
										<span className="text-stone-500 dark:text-stone-400 w-28 flex-shrink-0">
											Status
										</span>
										<Badge
											variant={
												rule.status === "ACTIVE" ? "default" : "secondary"
											}
										>
											{rule.status}
										</Badge>
									</div>
								</div>
							)}
						</div>

						<div className="border-t dark:border-stone-800" />

						{/* Section 2: Condition Groups */}
						<div className="flex flex-col gap-3">
							<div className="flex items-center justify-between">
								<h3 className="text-base font-semibold text-stone-800 dark:text-stone-200">
									Condition Groups
								</h3>
								<Button
									size="sm"
									onClick={saveConditions}
									disabled={isSavingConditions}
									className={isSavingConditions ? "animate-pulse" : ""}
								>
									Save Changes
								</Button>
							</div>
							<ConditionBuilder
								groups={conditionGroups}
								onChange={setConditionGroups}
							/>
						</div>

						<div className="border-t dark:border-stone-800" />

						{/* Section 3: Associated Entities */}
						<div className="flex flex-col gap-3">
							<h3 className="text-base font-semibold text-stone-800 dark:text-stone-200">
								Associated Entities
							</h3>

							{isLoadingEntities ? (
								<p className="text-sm text-stone-500 animate-pulse">
									Loading entities...
								</p>
							) : entities.length === 0 ? (
								<p className="text-sm text-stone-500 dark:text-stone-400">
									No entities associated yet.
								</p>
							) : (
								<div className="flex flex-col gap-2">
									{entities.map((entity) => (
										<div
											key={entity.id}
											className="flex items-center justify-between border dark:border-stone-700 rounded px-3 py-2 text-sm"
										>
											<div className="flex flex-col gap-0.5">
												<span className="text-stone-700 dark:text-stone-300 font-medium">
													{entity.entity_id}
												</span>
												<span className="text-xs text-stone-500 dark:text-stone-400">
													{entity.entity_type}
												</span>
											</div>
											<ConfirmationModal
												handleYes={deleteEntity}
												title="Remove this entity association?"
												subtitle="This will remove the link between the rule and this entity."
												params={{ id: entity.id }}
											>
												<button
													type="button"
													className="text-stone-400 hover:text-red-500"
												>
													<XIcon className="w-4 h-4" />
												</button>
											</ConfirmationModal>
										</div>
									))}
								</div>
							)}

							{/* Add Entity Form */}
							<div className="flex items-center gap-2 mt-1">
								<Select
									value={newEntityType}
									onValueChange={setNewEntityType}
								>
									<SelectTrigger className="h-8 w-32 text-xs flex-shrink-0">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="context">context</SelectItem>
										<SelectItem value="prompt">prompt</SelectItem>
										<SelectItem value="dataset">dataset</SelectItem>
										<SelectItem value="meta_config">meta_config</SelectItem>
									</SelectContent>
								</Select>
								<Input
									className="h-8 text-xs flex-1"
									placeholder="Entity ID"
									value={newEntityId}
									onChange={(e) => setNewEntityId(e.target.value)}
								/>
								<Button
									size="sm"
									variant="outline"
									type="button"
									className="h-8"
									disabled={isAddingEntity}
									onClick={addEntity}
								>
									<PlusIcon className="w-3 h-3 mr-1" />
									Associate
								</Button>
							</div>
						</div>
					</div>
				) : null}
			</SheetContent>
		</Sheet>
	);
}
