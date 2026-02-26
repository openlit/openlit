"use client";
import React from "react";
import { PlusIcon, TrashIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const CONDITION_FIELDS = [
	{ value: "ServiceName", label: "Service Name", dataType: "string" },
	{ value: "SpanName", label: "Span Name", dataType: "string" },
	{ value: "SpanKind", label: "Span Kind", dataType: "string" },
	{ value: "Duration", label: "Duration (ms)", dataType: "number" },
	{ value: "StatusCode", label: "Status Code", dataType: "string" },
	{ value: "deployment.environment", label: "Deployment Env", dataType: "string" },
	{ value: "service.name", label: "Service Name (OTel)", dataType: "string" },
	{ value: "gen_ai.system", label: "Gen AI System", dataType: "string" },
	{ value: "gen_ai.request.model", label: "Model", dataType: "string" },
	{ value: "gen_ai.usage.input_tokens", label: "Input Tokens", dataType: "number" },
	{ value: "gen_ai.usage.output_tokens", label: "Output Tokens", dataType: "number" },
	{ value: "gen_ai.usage.total_cost", label: "Total Cost ($)", dataType: "number" },
	{ value: "gen_ai.request.temperature", label: "Temperature", dataType: "number" },
];

const STRING_OPERATORS = [
	{ value: "equals", label: "=" },
	{ value: "not_equals", label: "≠" },
	{ value: "contains", label: "contains" },
	{ value: "not_contains", label: "not contains" },
	{ value: "starts_with", label: "starts with" },
	{ value: "ends_with", label: "ends with" },
	{ value: "regex", label: "regex" },
	{ value: "in", label: "in" },
	{ value: "not_in", label: "not in" },
];

const NUMBER_OPERATORS = [
	{ value: "equals", label: "=" },
	{ value: "not_equals", label: "≠" },
	{ value: "gt", label: ">" },
	{ value: "gte", label: "≥" },
	{ value: "lt", label: "<" },
	{ value: "lte", label: "≤" },
	{ value: "between", label: "between" },
];

function getOperatorsForDataType(dataType: string) {
	return dataType === "number" ? NUMBER_OPERATORS : STRING_OPERATORS;
}

function getDataTypeForField(fieldValue: string): string {
	return CONDITION_FIELDS.find((f) => f.value === fieldValue)?.dataType || "string";
}

function getLabelForField(fieldValue: string): string {
	return CONDITION_FIELDS.find((f) => f.value === fieldValue)?.label || fieldValue;
}

export type ConditionGroupState = {
	condition_operator: "AND" | "OR";
	conditions: Array<{
		field: string;
		operator: string;
		value: string;
		data_type: string;
	}>;
};

export default function ConditionBuilder({
	groups,
	onChange,
}: {
	groups: ConditionGroupState[];
	onChange: (groups: ConditionGroupState[]) => void;
}) {
	const addGroup = () => {
		onChange([
			...groups,
			{
				condition_operator: "AND",
				conditions: [{ field: "", operator: "", value: "", data_type: "string" }],
			},
		]);
	};

	const removeGroup = (groupIdx: number) => {
		onChange(groups.filter((_, i) => i !== groupIdx));
	};

	const updateGroupOperator = (groupIdx: number, operator: "AND" | "OR") => {
		const updated = [...groups];
		updated[groupIdx] = { ...updated[groupIdx], condition_operator: operator };
		onChange(updated);
	};

	const addCondition = (groupIdx: number) => {
		const updated = [...groups];
		updated[groupIdx] = {
			...updated[groupIdx],
			conditions: [
				...updated[groupIdx].conditions,
				{ field: "", operator: "", value: "", data_type: "string" },
			],
		};
		onChange(updated);
	};

	const removeCondition = (groupIdx: number, condIdx: number) => {
		const updated = [...groups];
		updated[groupIdx] = {
			...updated[groupIdx],
			conditions: updated[groupIdx].conditions.filter((_, i) => i !== condIdx),
		};
		onChange(updated);
	};

	const updateConditionField = (groupIdx: number, condIdx: number, fieldValue: string) => {
		const updated = [...groups];
		const dataType = getDataTypeForField(fieldValue);
		updated[groupIdx] = {
			...updated[groupIdx],
			conditions: updated[groupIdx].conditions.map((c, i) =>
				i === condIdx ? { ...c, field: fieldValue, data_type: dataType, operator: "" } : c
			),
		};
		onChange(updated);
	};

	const updateConditionOperator = (groupIdx: number, condIdx: number, operator: string) => {
		const updated = [...groups];
		updated[groupIdx] = {
			...updated[groupIdx],
			conditions: updated[groupIdx].conditions.map((c, i) =>
				i === condIdx ? { ...c, operator } : c
			),
		};
		onChange(updated);
	};

	const updateConditionValue = (groupIdx: number, condIdx: number, value: string) => {
		const updated = [...groups];
		updated[groupIdx] = {
			...updated[groupIdx],
			conditions: updated[groupIdx].conditions.map((c, i) =>
				i === condIdx ? { ...c, value } : c
			),
		};
		onChange(updated);
	};

	if (groups.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 py-6 border-2 border-dashed border-stone-200 dark:border-stone-700 rounded-lg">
				<p className="text-sm text-stone-400 dark:text-stone-500">
					No condition groups yet.
				</p>
				<Button variant="outline" size="sm" type="button" onClick={addGroup}
					className="border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-400">
					<PlusIcon className="w-3 h-3 mr-1" />
					Add First Group
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			{groups.map((group, groupIdx) => (
				<div key={groupIdx}
					className="rounded-lg border-2 border-stone-200 dark:border-stone-700 bg-stone-50/50 dark:bg-stone-900/50 p-3">
					{/* Group header */}
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-2">
							<span className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-500">
								Group {groupIdx + 1}
							</span>
							<Select
								value={group.condition_operator}
								onValueChange={(val) => updateGroupOperator(groupIdx, val as "AND" | "OR")}
							>
								<SelectTrigger className="h-6 w-auto text-xs px-2 border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="AND">AND</SelectItem>
									<SelectItem value="OR">OR</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<button type="button" onClick={() => removeGroup(groupIdx)}
							className="text-stone-300 hover:text-red-500 dark:text-stone-600 dark:hover:text-red-400 transition-colors">
							<TrashIcon className="w-3.5 h-3.5" />
						</button>
					</div>

					{/* Conditions — box inside box */}
					<div className="flex flex-col">
						{group.conditions.map((cond, condIdx) => (
							<React.Fragment key={condIdx}>
								{/* Operator connector row between conditions */}
								{condIdx > 0 && (
									<div className="flex items-center gap-2 py-1 px-1">
										<div className="flex-1 border-t border-dashed border-stone-200 dark:border-stone-700" />
										<Badge variant="outline"
											className="text-[9px] px-1.5 py-0 h-4 border-stone-300 dark:border-stone-600 text-stone-400 dark:text-stone-500 flex-shrink-0">
											{group.condition_operator}
										</Badge>
										<div className="flex-1 border-t border-dashed border-stone-200 dark:border-stone-700" />
									</div>
								)}
								<div className="flex items-center gap-2 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-2">
									<Select
										value={cond.field}
										onValueChange={(val) => updateConditionField(groupIdx, condIdx, val)}
									>
										<SelectTrigger className="h-7 flex-1 text-xs border-stone-200 dark:border-stone-700 min-w-0">
											<SelectValue placeholder="Field" />
										</SelectTrigger>
										<SelectContent>
											{CONDITION_FIELDS.map((f) => (
												<SelectItem key={f.value} value={f.value}>
													<span className="flex items-center gap-2">
														<span>{f.label}</span>
														<Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-stone-200 dark:border-stone-700">
															{f.dataType}
														</Badge>
													</span>
												</SelectItem>
											))}
										</SelectContent>
									</Select>

									<Select
										value={cond.operator}
										onValueChange={(val) => updateConditionOperator(groupIdx, condIdx, val)}
									>
										<SelectTrigger className="h-7 w-28 text-xs border-stone-200 dark:border-stone-700 flex-shrink-0">
											<SelectValue placeholder="Op" />
										</SelectTrigger>
										<SelectContent>
											{getOperatorsForDataType(cond.data_type).map((op) => (
												<SelectItem key={op.value} value={op.value}>
													{op.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>

									<Input
										className="h-7 flex-1 text-xs border-stone-200 dark:border-stone-700 min-w-0 bg-stone-50 dark:bg-stone-800/50"
										placeholder="Value"
										value={cond.value}
										onChange={(e) => updateConditionValue(groupIdx, condIdx, e.target.value)}
									/>

									<button type="button"
										onClick={() => removeCondition(groupIdx, condIdx)}
										className="text-stone-300 hover:text-red-500 dark:text-stone-600 dark:hover:text-red-400 transition-colors flex-shrink-0">
										<XIcon className="w-3.5 h-3.5" />
									</button>
								</div>
							</React.Fragment>
						))}
					</div>

					<Button variant="ghost" size="sm" type="button"
						onClick={() => addCondition(groupIdx)}
						className="mt-2 h-7 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800">
						<PlusIcon className="w-3 h-3 mr-1" />
						Add Condition
					</Button>
				</div>
			))}

			<Button variant="outline" size="sm" type="button"
				onClick={addGroup}
				className="self-start border-dashed border-stone-300 dark:border-stone-600 text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">
				<PlusIcon className="w-3.5 h-3.5 mr-1" />
				Add Group
			</Button>
		</div>
	);
}
