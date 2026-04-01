"use client";
import { useCallback, useEffect, useState } from "react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { Rule, RuleConditionGroup } from "@/types/rule-engine";
import ConditionBuilder, {
	ConditionGroupState,
} from "@/components/(playground)/rule-engine/condition-builder";
import RuleInfoSection, {
	RuleInfoEditValues,
} from "@/components/(playground)/rule-engine/rule-info-section";
import RulePreviewSection from "@/components/(playground)/rule-engine/rule-preview-section";
import RuleEntitiesCard from "@/components/(playground)/rule-engine/rule-entities-card";
import { usePageHeader } from "@/selectors/page";
import getMessage from "@/constants/messages";

type RuleDetail = Rule & { condition_groups?: RuleConditionGroup[] };

const DEFAULT_CONDITION_GROUP: ConditionGroupState = {
	condition_operator: "AND",
	conditions: [
		{
			field: "service.name",
			operator: "regex",
			value: ".*",
			data_type: "string",
		},
	],
};

export default function RuleDetailPage() {
	const posthog = usePostHog();
	const params = useParams();
	const ruleId = params.id as string;
	const { setHeader } = usePageHeader();
	const messages = getMessage();

	const [isEditingInfo, setIsEditingInfo] = useState(false);
	const [editValues, setEditValues] = useState<RuleInfoEditValues>({
		name: "",
		description: "",
		groupOperator: "AND",
		status: "ACTIVE",
	});
	const [conditionGroups, setConditionGroups] = useState<ConditionGroupState[]>(
		[]
	);

	const { fireRequest: fetchRuleReq, data: rule, isLoading } =
		useFetchWrapper<RuleDetail>();
	const { fireRequest: fireUpdateReq, isLoading: isUpdating } = useFetchWrapper();
	const { fireRequest: fireSaveConditions, isLoading: isSavingConditions } =
		useFetchWrapper();

	const fetchRule = useCallback(() => {
		fetchRuleReq({
			requestType: "GET",
			url: `/api/rule-engine/rules/${ruleId}`,
			successCb: (data: any) => {
				setEditValues({
					name: data.name || "",
					description: data.description || "",
					groupOperator: data.group_operator || "AND",
					status: data.status || "ACTIVE",
				});
				setHeader({
					title: data.name,
					breadcrumbs: [
						{ title: messages.RULE_ENGINE_BREADCRUMB, href: "/rule-engine" },
					],
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
				setConditionGroups(
					groups.length > 0 ? groups : [DEFAULT_CONDITION_GROUP]
				);
			},
			failureCb: (err?: string) => {
				toast.error(err || messages.RULE_LOAD_FAILED, { id: "rule-detail" });
			},
		});
	}, [ruleId]);

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.RULE_ENGINE_DETAIL_PAGE_VISITED);
	}, []);

	useEffect(() => {
		fetchRule();
	}, [ruleId]);

	const handleInfoChange = useCallback(
		(field: keyof RuleInfoEditValues, value: string) => {
			setEditValues((prev) => ({ ...prev, [field]: value }));
		},
		[]
	);

	const handleInfoEdit = useCallback(() => setIsEditingInfo(true), []);

	const handleInfoCancel = useCallback(() => {
		const r = rule as any;
		if (r) {
			setEditValues({
				name: r.name || "",
				description: r.description || "",
				groupOperator: r.group_operator || "AND",
				status: r.status || "ACTIVE",
			});
		}
		setIsEditingInfo(false);
	}, [rule]);

	const handleInfoSave = useCallback(() => {
		fireUpdateReq({
			body: JSON.stringify({
				name: editValues.name,
				description: editValues.description,
				group_operator: editValues.groupOperator,
				status: editValues.status,
			}),
			requestType: "PUT",
			url: `/api/rule-engine/rules/${ruleId}`,
			successCb: () => {
				toast.success(messages.RULE_UPDATED, { id: "rule-detail" });
				setIsEditingInfo(false);
				fetchRule();
			},
			failureCb: (err?: string) => {
				toast.error(err || messages.RULE_UPDATE_FAILED, { id: "rule-detail" });
			},
		});
	}, [ruleId, editValues]);

	const saveConditions = useCallback(() => {
		fireSaveConditions({
			body: JSON.stringify({ condition_groups: conditionGroups }),
			requestType: "POST",
			url: `/api/rule-engine/rules/${ruleId}/conditions`,
			successCb: () => {
				toast.success(messages.RULE_CONDITIONS_SAVED, {
					id: "rule-conditions",
				});
				fetchRule();
			},
			failureCb: (err?: string) => {
				toast.error(err || messages.RULE_CONDITIONS_SAVE_FAILED, {
					id: "rule-conditions",
				});
			},
		});
	}, [ruleId, conditionGroups]);

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

	return (
		<div className="grid grid-cols-3 w-full h-full overflow-hidden gap-4">
			{/* Left: Rule info + condition builder */}
			<Card className="col-span-2 overflow-hidden flex flex-col border border-stone-200 dark:border-stone-800">
				<CardHeader className="p-4 pb-3 border-b border-stone-100 dark:border-stone-800">
					<RuleInfoSection
						rule={r}
						isEditing={isEditingInfo}
						editValues={editValues}
						isSaving={isUpdating}
						onChange={handleInfoChange}
						onEdit={handleInfoEdit}
						onCancel={handleInfoCancel}
						onSave={handleInfoSave}
					/>
				</CardHeader>

				<CardContent className="flex flex-col gap-5 p-4 overflow-y-auto scrollbar-hidden flex-1">
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<CardTitle className="text-sm font-semibold text-stone-700 dark:text-stone-300">
								{messages.RULE_CONDITION_GROUPS_TITLE}
							</CardTitle>
							<Button
								size="sm"
								onClick={saveConditions}
								disabled={isSavingConditions}
								className={`h-7 text-xs ${isSavingConditions ? "animate-pulse" : ""}`}
							>
								<CheckIcon className="w-3 h-3 mr-1" />
								{messages.RULE_SAVE_CONDITIONS}
							</Button>
						</div>
						<ConditionBuilder
							groups={conditionGroups}
							onChange={setConditionGroups}
							groupOperator={editValues.groupOperator}
						/>
					</div>
				</CardContent>
			</Card>

			{/* Right: Preview + Entities */}
			<div className="grid grid-flow-row grid-rows-2 gap-4 overflow-hidden scrollbar-hidden">
				<RulePreviewSection ruleId={ruleId} />
				<RuleEntitiesCard ruleId={ruleId} />
			</div>
		</div>
	);
}
