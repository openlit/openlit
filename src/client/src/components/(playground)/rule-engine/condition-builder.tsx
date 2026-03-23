"use client";
import React, { useEffect, useRef, useState } from "react";
import { CheckIcon, InfoIcon, PlusIcon, TrashIcon, XIcon } from "lucide-react";
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
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRootStore } from "@/store";
import getMessage from "@/constants/messages";

export const CONDITION_FIELDS = () => {
	const m = getMessage();
	return [
		{ value: "ServiceName", label: m.RULE_FIELD_SERVICE_NAME, dataType: "string", description: m.RULE_FIELD_SERVICE_NAME_DESC },
		{ value: "SpanName", label: m.RULE_FIELD_SPAN_NAME, dataType: "string", description: m.RULE_FIELD_SPAN_NAME_DESC },
		{ value: "SpanKind", label: m.RULE_FIELD_SPAN_KIND, dataType: "string", description: m.RULE_FIELD_SPAN_KIND_DESC },
		{ value: "Duration", label: m.RULE_FIELD_DURATION, dataType: "number", description: m.RULE_FIELD_DURATION_DESC },
		{ value: "StatusCode", label: m.RULE_FIELD_STATUS_CODE, dataType: "string", description: m.RULE_FIELD_STATUS_CODE_DESC },
		{ value: "deployment.environment", label: m.RULE_FIELD_DEPLOYMENT_ENV, dataType: "string", description: m.RULE_FIELD_DEPLOYMENT_ENV_DESC },
		{ value: "service.name", label: m.RULE_FIELD_SERVICE_NAME_OTEL, dataType: "string", description: m.RULE_FIELD_SERVICE_NAME_OTEL_DESC },
		{ value: "gen_ai.system", label: m.RULE_FIELD_GEN_AI_SYSTEM, dataType: "string", description: m.RULE_FIELD_GEN_AI_SYSTEM_DESC },
		{ value: "gen_ai.request.model", label: m.RULE_FIELD_MODEL, dataType: "string", description: m.RULE_FIELD_MODEL_DESC },
		{ value: "gen_ai.usage.input_tokens", label: m.RULE_FIELD_INPUT_TOKENS, dataType: "number", description: m.RULE_FIELD_INPUT_TOKENS_DESC },
		{ value: "gen_ai.usage.output_tokens", label: m.RULE_FIELD_OUTPUT_TOKENS, dataType: "number", description: m.RULE_FIELD_OUTPUT_TOKENS_DESC },
		{ value: "gen_ai.usage.total_cost", label: m.RULE_FIELD_TOTAL_COST, dataType: "number", description: m.RULE_FIELD_TOTAL_COST_DESC },
		{ value: "gen_ai.request.temperature", label: m.RULE_FIELD_TEMPERATURE, dataType: "number", description: m.RULE_FIELD_TEMPERATURE_DESC },
	];
};

// Fields that support dynamic value lookup from otel_traces
const FIELDS_WITH_VALUES = new Set([
	"ServiceName", "SpanName", "SpanKind", "StatusCode",
	"deployment.environment", "service.name", "gen_ai.system", "gen_ai.request.model",
]);

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
	return CONDITION_FIELDS().find((f) => f.value === fieldValue)?.dataType || "string";
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

// Info tooltip icon shown inline
function FieldInfo({ text }: { text: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<InfoIcon className="w-3 h-3 text-stone-400 dark:text-stone-500 cursor-help flex-shrink-0" />
			</TooltipTrigger>
			<TooltipContent side="top" className="max-w-[200px] text-xs">
				{text}
			</TooltipContent>
		</Tooltip>
	);
}

// Combobox for string field values with dynamic loading and custom entry
function ConditionValueInput({
	field,
	value,
	onChange,
}: {
	field: string;
	value: string;
	onChange: (v: string) => void;
}) {
	const messages = getMessage();
	const [open, setOpen] = useState(false);
	const [inputValue, setInputValue] = useState(value);
	const inputRef = useRef<HTMLInputElement>(null);

	const fieldValuesCache = useRootStore((s) => s.ruleEngine?.fieldValuesCache ?? {});
	const fieldValuesLoading = useRootStore((s) => s.ruleEngine?.fieldValuesLoading ?? {});
	const setFieldValues = useRootStore((s) => s.ruleEngine?.setFieldValues ?? (() => {}));
	const setFieldValuesLoading = useRootStore((s) => s.ruleEngine?.setFieldValuesLoading ?? (() => {}));

	const cached = fieldValuesCache[field] ?? null;
	const isLoading = fieldValuesLoading[field] ?? false;

	// Keep input in sync when value changes from outside (e.g. field change resets value)
	useEffect(() => {
		setInputValue(value);
	}, [value]);

	// Load values from API when a supported field is selected and not yet cached
	useEffect(() => {
		if (!field || !FIELDS_WITH_VALUES.has(field) || cached !== null) return;
		setFieldValuesLoading(field, true);
		fetch(`/api/rule-engine/field-values?field=${encodeURIComponent(field)}`)
			.then((r) => r.json())
			.then((d) => setFieldValues(field, d.values ?? []))
			.catch(() => setFieldValues(field, []))
			.finally(() => setFieldValuesLoading(field, false));
	}, [field]);

	// For number fields or fields without value lookup, plain input
	if (!FIELDS_WITH_VALUES.has(field)) {
		return (
			<Input
				className="h-7 flex-1 text-xs border-stone-200 dark:border-stone-700 min-w-0 bg-stone-50 dark:bg-stone-800/50"
				placeholder={messages.RULE_VALUE_PLACEHOLDER}
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
		);
	}

	const suggestions = (cached ?? []).filter((v) =>
		v.toLowerCase().includes(inputValue.toLowerCase())
	);
	const showCustomEntry = inputValue.trim() && !suggestions.includes(inputValue.trim());

	const handleSelect = (v: string) => {
		onChange(v);
		setInputValue(v);
		setOpen(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (inputValue.trim()) handleSelect(inputValue.trim());
		} else if (e.key === "Escape") {
			setOpen(false);
		}
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<div
					className="h-7 flex-1 flex items-center min-w-0 border border-stone-200 dark:border-stone-700 rounded-md bg-stone-50 dark:bg-stone-800/50 px-2 cursor-text"
					onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
				>
					<span className="text-xs truncate flex-1">
						{value
							? <span className="text-stone-700 dark:text-stone-300">{value}</span>
							: <span className="text-stone-400 dark:text-stone-500">{messages.RULE_VALUE_PLACEHOLDER}</span>
						}
					</span>
				</div>
			</PopoverTrigger>
			<PopoverContent className="p-0 w-56" align="start" side="bottom">
				<Command shouldFilter={false}>
					<CommandInput
						ref={inputRef}
						placeholder={messages.RULE_FIELD_VALUES_SEARCH}
						value={inputValue}
						onValueChange={(v) => { setInputValue(v); onChange(v); }}
						onKeyDown={handleKeyDown}
						className="h-8 text-xs"
					/>
					<CommandList>
						{isLoading && (
							<div className="py-2 px-3 text-xs text-stone-400 animate-pulse">
								{messages.RULE_FIELD_VALUES_LOADING}
							</div>
						)}
						{!isLoading && cached !== null && (
							<>
								<div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-stone-100 dark:border-stone-800">
									<InfoIcon className="w-3 h-3 text-stone-400 flex-shrink-0" />
									<span className="text-[10px] text-stone-400 dark:text-stone-500 leading-tight">
										{messages.RULE_FIELD_VALUES_INFO}
									</span>
								</div>
								{showCustomEntry && (
									<CommandItem
										value={inputValue}
										onSelect={() => handleSelect(inputValue.trim())}
										className="text-xs"
									>
										<PlusIcon className="w-3 h-3 mr-1.5 text-stone-400" />
										Add &quot;{inputValue}&quot;
									</CommandItem>
								)}
								{suggestions.length === 0 && !showCustomEntry && (
									<CommandEmpty className="text-xs py-4">
										{messages.RULE_FIELD_VALUES_NO_MATCH}
									</CommandEmpty>
								)}
								{suggestions.length > 0 && (
									<CommandGroup>
										{suggestions.map((v) => (
											<CommandItem
												key={v}
												value={v}
												onSelect={() => handleSelect(v)}
												className="text-xs"
											>
												<CheckIcon className={`w-3 h-3 mr-1.5 flex-shrink-0 ${value === v ? "opacity-100 text-stone-700 dark:text-stone-200" : "opacity-0"}`} />
												<span className="truncate">{v}</span>
											</CommandItem>
										))}
									</CommandGroup>
								)}
							</>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

export default function ConditionBuilder({
	groups,
	onChange,
	groupOperator = "AND",
}: {
	groups: ConditionGroupState[];
	onChange: (groups: ConditionGroupState[]) => void;
	groupOperator?: "AND" | "OR";
}) {
	const messages = getMessage();
	const fields = CONDITION_FIELDS();

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
				i === condIdx ? { ...c, field: fieldValue, data_type: dataType, operator: "", value: "" } : c
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
					{messages.RULE_NO_CONDITION_GROUPS}
				</p>
				<Button variant="outline" size="sm" type="button" onClick={addGroup}
					className="border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-400">
					<PlusIcon className="w-3 h-3 mr-1" />
					{messages.RULE_ADD_FIRST_GROUP}
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			{groups.map((group, groupIdx) => (
				<React.Fragment key={groupIdx}>
					{/* Group operator pill BETWEEN groups (uses rule-level groupOperator) */}
					{groupIdx > 0 && (
						<div className="flex items-center gap-2">
							<div className="flex-1 border-t border-dashed border-stone-300 dark:border-stone-700" />
							<Badge
								variant="outline"
								className="text-[10px] px-2 py-0.5 h-5 border-stone-400 dark:border-stone-500 text-stone-600 dark:text-stone-400 font-bold tracking-wider flex-shrink-0 bg-white dark:bg-stone-950"
							>
								{groupOperator}
							</Badge>
							<div className="flex-1 border-t border-dashed border-stone-300 dark:border-stone-700" />
						</div>
					)}

					<div className="rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/50 p-3">
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
										<SelectItem value="AND">{messages.AND}</SelectItem>
										<SelectItem value="OR">{messages.OR}</SelectItem>
									</SelectContent>
								</Select>
								<span className="text-[10px] text-stone-400 dark:text-stone-500">
									{messages.RULE_WITHIN_GROUP}
								</span>
							</div>
							<button type="button" onClick={() => removeGroup(groupIdx)}
								className="text-stone-300 hover:text-red-500 dark:text-stone-600 dark:hover:text-red-400 transition-colors">
								<TrashIcon className="w-3.5 h-3.5" />
							</button>
						</div>

						{/* Conditions */}
						<div className="flex flex-col">
							{group.conditions.map((cond, condIdx) => (
								<React.Fragment key={condIdx}>
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
										{/* Field selector with info tooltip */}
										<div className="flex items-center gap-1 flex-1 min-w-0">
											<Select
												value={cond.field}
												onValueChange={(val) => updateConditionField(groupIdx, condIdx, val)}
											>
												<SelectTrigger className="h-7 flex-1 text-xs border-stone-200 dark:border-stone-700 min-w-0">
													<SelectValue placeholder={messages.RULE_FIELD_PLACEHOLDER} />
												</SelectTrigger>
												<SelectContent>
													{fields.map((f) => (
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
											{/* Show info tooltip for selected field */}
											{cond.field && (
												<FieldInfo
													text={fields.find((f) => f.value === cond.field)?.description ?? cond.field}
												/>
											)}
										</div>

										<Select
											value={cond.operator}
											onValueChange={(val) => updateConditionOperator(groupIdx, condIdx, val)}
										>
											<SelectTrigger className="h-7 w-28 text-xs border-stone-200 dark:border-stone-700 flex-shrink-0">
												<SelectValue placeholder={messages.RULE_OPERATOR_PLACEHOLDER} />
											</SelectTrigger>
											<SelectContent>
												{getOperatorsForDataType(cond.data_type).map((op) => (
													<SelectItem key={op.value} value={op.value}>
														{op.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>

										<ConditionValueInput
											field={cond.field}
											value={cond.value}
											onChange={(v) => updateConditionValue(groupIdx, condIdx, v)}
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
							{messages.RULE_ADD_CONDITION}
						</Button>
					</div>
				</React.Fragment>
			))}

			<Button variant="outline" size="sm" type="button"
				onClick={addGroup}
				className="self-start border-dashed border-stone-300 dark:border-stone-600 text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">
				<PlusIcon className="w-3.5 h-3.5 mr-1" />
				{messages.RULE_ADD_GROUP}
			</Button>
		</div>
	);
}
