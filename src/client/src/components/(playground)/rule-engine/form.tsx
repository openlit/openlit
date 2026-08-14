"use client";
import FormBuilder from "@/components/common/form-builder";
import { FieldProps, FormBuilderEvent } from "@/types/form";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { InfoIcon } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import getMessage from "@/constants/messages";

function FieldInfo({ text }: { text: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<InfoIcon className="w-3.5 h-3.5 text-stone-400 cursor-help inline ml-1 align-middle" />
			</TooltipTrigger>
			<TooltipContent side="top" className="max-w-[220px] text-xs">
				{text}
			</TooltipContent>
		</Tooltip>
	);
}

export default function RuleForm({
	entityId,
	entityType,
	children,
	successCallback,
}: {
	entityId?: string;
	entityType?: string;
	children: JSX.Element;
	successCallback?: () => void;
}) {
	const messages = getMessage();
	const [isOpen, setIsOpen] = useState(false);
	const [groupOperator, setGroupOperator] = useState<string>("AND");
	const [status, setStatus] = useState<string>("ACTIVE");
	const { fireRequest, isLoading } = useFetchWrapper();
	const { fireRequest: fireEntityRequest } = useFetchWrapper();

	const createRule: FormBuilderEvent = useCallback(
		(event, formdata) => {
			event.preventDefault();
			toast.loading(messages.RULE_CREATING, { id: "rule-engine" });

			const payload = {
				name: formdata.name,
				description: formdata.description,
				group_operator: groupOperator,
				status: status,
			};

			fireRequest({
				body: JSON.stringify(payload),
				requestType: "POST",
				url: "/api/rule-engine/rules",
				successCb: (res: any) => {
					const ruleId = res?.id;

					if (entityId && entityType && ruleId) {
						fireEntityRequest({
							body: JSON.stringify({
								rule_id: ruleId,
								entity_type: entityType,
								entity_id: entityId,
							}),
							requestType: "POST",
							url: "/api/rule-engine/entities",
							successCb: () => {
								toast.success(
									`${messages.RULE_CREATE_AND_LINK_TO} ${entityType}`,
									{ id: "rule-engine" }
								);
							},
							failureCb: () => {
								toast.success(messages.RULE_CREATED, {
									id: "rule-engine",
								});
							},
						});
					} else {
						toast.success(messages.RULE_CREATED, {
							id: "rule-engine",
						});
					}

					setIsOpen(false);
					if (typeof successCallback === "function") {
						successCallback();
					}
				},
				failureCb: (err?: string) => {
					toast.error(err || messages.RULE_CREATE_FAILED, {
						id: "rule-engine",
					});
				},
			});
		},
		[entityId, entityType, successCallback, groupOperator, status]
	);

	const formFields: FieldProps[] = [
		{
			label: `${messages.NAME} *`,
			inputKey: "rule-name",
			fieldType: "INPUT",
			fieldTypeProps: {
				type: "text",
				name: "name",
				placeholder: messages.RULE_NAME_PLACEHOLDER,
				defaultValue: "",
				required: true,
			},
			description: <FieldInfo text={messages.RULE_NAME_INFO} />,
		},
		{
			label: messages.RULE_DESCRIPTION_LABEL,
			inputKey: "rule-description",
			fieldType: "TEXTAREA",
			fieldTypeProps: {
				name: "description",
				placeholder: messages.RULE_DESCRIPTION_PLACEHOLDER,
				defaultValue: "",
				rows: 2,
			} as any,
			description: <FieldInfo text={messages.RULE_DESCRIPTION_INFO} />,
		},
		{
			label: `${messages.RULE_GROUP_OPERATOR_LABEL} *`,
			inputKey: "rule-group_operator",
			fieldType: "SELECT",
			fieldTypeProps: {
				name: "group_operator",
				placeholder: messages.PLEASE_SELECT,
				defaultValue: "AND",
				options: [
					{ value: "AND", label: messages.RULE_GROUP_OPERATOR_AND },
					{ value: "OR", label: messages.RULE_GROUP_OPERATOR_OR },
				],
				onChange: setGroupOperator,
			} as any,
			description: <FieldInfo text={messages.RULE_GROUP_OPERATOR_INFO} />,
		},
		{
			label: `${messages.STATUS} *`,
			inputKey: "rule-status",
			fieldType: "SELECT",
			fieldTypeProps: {
				name: "status",
				placeholder: messages.PLEASE_SELECT,
				defaultValue: "ACTIVE",
				options: [
					{ value: "ACTIVE", label: messages.ACTIVE },
					{ value: "INACTIVE", label: messages.RULE_INACTIVE },
				],
				onChange: setStatus,
			} as any,
			description: <FieldInfo text={messages.RULE_STATUS_INFO} />,
		},
	];

	return (
		<Dialog onOpenChange={setIsOpen} open={isOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="max-w-xl bg-white dark:bg-stone-950 border-stone-200 dark:border-stone-800">
				<DialogHeader>
					<DialogTitle className="text-stone-900 dark:text-stone-100">
						{entityId
							? `${messages.RULE_CREATE_AND_LINK_TO} ${entityType}`
							: messages.RULE_CREATE_NEW}
					</DialogTitle>
				</DialogHeader>
				<div className="flex items-center overflow-y-auto">
					<FormBuilder
						alignment="vertical"
						fields={formFields}
						isLoading={isLoading}
						onSubmit={createRule}
						submitButtonText={messages.RULE_CREATE_SUBMIT}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
