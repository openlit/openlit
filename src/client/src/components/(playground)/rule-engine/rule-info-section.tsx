"use client";
import { CheckIcon, InfoIcon, PencilIcon, XIcon } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import getMessage from "@/constants/messages";

function FieldLabel({
	label,
	required,
	info,
}: {
	label: string;
	required?: boolean;
	info: string;
}) {
	return (
		<span className="flex items-center gap-1">
			<span className="text-xs font-medium text-stone-500 dark:text-stone-400">
				{label}
				{required && <span className="text-red-500 ml-0.5">*</span>}
			</span>
			<Tooltip>
				<TooltipTrigger asChild>
					<InfoIcon className="w-3 h-3 text-stone-400 dark:text-stone-500 cursor-help" />
				</TooltipTrigger>
				<TooltipContent side="top" className="max-w-[220px] text-xs">
					{info}
				</TooltipContent>
			</Tooltip>
		</span>
	);
}

export type RuleInfoEditValues = {
	name: string;
	description: string;
	groupOperator: "AND" | "OR";
	status: "ACTIVE" | "INACTIVE";
};

type Props = {
	rule: any;
	isEditing: boolean;
	editValues: RuleInfoEditValues;
	isSaving: boolean;
	onChange: (field: keyof RuleInfoEditValues, value: string) => void;
	onEdit: () => void;
	onCancel: () => void;
	onSave: () => void;
};

export default function RuleInfoSection({
	rule,
	isEditing,
	editValues,
	isSaving,
	onChange,
	onEdit,
	onCancel,
	onSave,
}: Props) {
	const messages = getMessage();

	return (
		<>
			{/* Header row */}
			<div className="flex items-start justify-between gap-4">
				{isEditing ? (
					<Input
						value={editValues.name}
						onChange={(e) => onChange("name", e.target.value)}
						className="text-lg font-semibold h-9 border-stone-300 dark:border-stone-600"
					/>
				) : (
					<div className="flex items-center gap-3 flex-wrap">
						<span className="text-xl font-semibold text-stone-900 dark:text-stone-100">
							{rule.name}
						</span>
						<Badge variant={rule.status === "ACTIVE" ? "default" : "secondary"}>
							{rule.status}
						</Badge>
						<Badge variant="outline">{rule.group_operator}</Badge>
					</div>
				)}

				<div className="flex items-center gap-2 flex-shrink-0">
					{isEditing ? (
						<>
							<Button
								size="sm"
								variant="outline"
								onClick={onCancel}
								className="h-8 text-stone-600 dark:text-stone-400"
							>
								<XIcon className="w-4 h-4 mr-1" />
								{messages.CANCEL}
							</Button>
							<Button
								size="sm"
								onClick={onSave}
								disabled={isSaving}
								className={`h-8 ${isSaving ? "animate-pulse" : ""}`}
							>
								<CheckIcon className="w-4 h-4 mr-1" />
								{messages.SAVE}
							</Button>
						</>
					) : (
						<Button
							size="sm"
							variant="ghost"
							onClick={onEdit}
							className="h-8 text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
						>
							<PencilIcon className="w-4 h-4 mr-1" />
							{messages.EDIT_DETAILS}
						</Button>
					)}
				</div>
			</div>

			{/* Metadata row */}
			{!isEditing && rule.created_by && (
				<p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
					{messages.RULE_CREATED_BY} {rule.created_by}
					{rule.created_at && (
						<> · {format(new Date(rule.created_at), "MMM do, y")}</>
					)}
				</p>
			)}

			{/* Edit form */}
			{isEditing && (
				<div className="flex flex-col gap-3 mt-3 p-3 rounded-md bg-stone-50 dark:bg-stone-900/50 border border-stone-200 dark:border-stone-700">
					<div className="flex flex-col gap-1">
						<FieldLabel
							label={messages.RULE_DESCRIPTION_LABEL}
							info={messages.RULE_DESCRIPTION_INFO}
						/>
						<Input
							value={editValues.description}
							onChange={(e) => onChange("description", e.target.value)}
							placeholder={messages.RULE_DESCRIPTION_PLACEHOLDER}
							className="border-stone-300 dark:border-stone-600"
						/>
					</div>

					<div className="flex gap-3">
						<div className="flex flex-col gap-1 flex-1">
							<FieldLabel
								label={messages.RULE_GROUP_OPERATOR_LABEL}
								required
								info={messages.RULE_GROUP_OPERATOR_INFO}
							/>
							<Select
								value={editValues.groupOperator}
								onValueChange={(v) => onChange("groupOperator", v)}
							>
								<SelectTrigger className="border-stone-300 dark:border-stone-600">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="AND">
										{messages.RULE_GROUP_OPERATOR_AND}
									</SelectItem>
									<SelectItem value="OR">
										{messages.RULE_GROUP_OPERATOR_OR}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-1 flex-1">
							<FieldLabel
								label={messages.STATUS}
								required
								info={messages.RULE_STATUS_INFO}
							/>
							<Select
								value={editValues.status}
								onValueChange={(v) => onChange("status", v)}
							>
								<SelectTrigger className="border-stone-300 dark:border-stone-600">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="ACTIVE">{messages.ACTIVE}</SelectItem>
									<SelectItem value="INACTIVE">{messages.RULE_INACTIVE}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
			)}

			{/* Description (read-only) */}
			{!isEditing && rule.description && (
				<p className="text-sm text-stone-600 dark:text-stone-400 mt-1">
					{rule.description}
				</p>
			)}
		</>
	);
}
