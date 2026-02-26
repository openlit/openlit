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
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useCallback, useState } from "react";
import { toast } from "sonner";

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
	const [isOpen, setIsOpen] = useState(false);
	const [groupOperator, setGroupOperator] = useState<string>("AND");
	const [status, setStatus] = useState<string>("ACTIVE");
	const { fireRequest, isLoading } = useFetchWrapper();
	const { fireRequest: fireEntityRequest } = useFetchWrapper();

	const createRule: FormBuilderEvent = useCallback(
		(event, formdata) => {
			event.preventDefault();
			toast.loading("Creating rule...", { id: "rule-engine" });

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
									`Rule created and linked to ${entityType}`,
									{ id: "rule-engine" }
								);
							},
							failureCb: () => {
								toast.success("Rule created successfully!", {
									id: "rule-engine",
								});
							},
						});
					} else {
						toast.success("Rule created successfully!", {
							id: "rule-engine",
						});
					}

					setIsOpen(false);
					if (typeof successCallback === "function") {
						successCallback();
					}
				},
				failureCb: (err?: string) => {
					toast.error(err || "Creation of rule failed!", {
						id: "rule-engine",
					});
				},
			});
		},
		[entityId, entityType, successCallback, groupOperator, status]
	);

	const formFields: FieldProps[] = [
		{
			label: "Name",
			inputKey: "rule-name",
			fieldType: "INPUT",
			fieldTypeProps: {
				type: "text",
				name: "name",
				placeholder: "My Rule",
				defaultValue: "",
			},
		},
		{
			label: "Description",
			inputKey: "rule-description",
			fieldType: "TEXTAREA",
			fieldTypeProps: {
				name: "description",
				placeholder: "Optional description",
				defaultValue: "",
				rows: 2,
			} as any,
		},
		{
			label: "Group Operator",
			inputKey: "rule-group_operator",
			fieldType: "SELECT",
			fieldTypeProps: {
				name: "group_operator",
				placeholder: "Select operator",
				defaultValue: "AND",
				options: [
					{ value: "AND", label: "AND" },
					{ value: "OR", label: "OR" },
				],
				onChange: setGroupOperator,
			} as any,
		},
		{
			label: "Status",
			inputKey: "rule-status",
			fieldType: "SELECT",
			fieldTypeProps: {
				name: "status",
				placeholder: "Select status",
				defaultValue: "ACTIVE",
				options: [
					{ value: "ACTIVE", label: "Active" },
					{ value: "INACTIVE", label: "Inactive" },
				],
				onChange: setStatus,
			} as any,
		},
	];

	return (
		<Dialog onOpenChange={setIsOpen} open={isOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="max-w-xl bg-white dark:bg-stone-950 border-stone-200 dark:border-stone-800">
				<DialogHeader>
					<DialogTitle className="text-stone-900 dark:text-stone-100">
						{entityId
							? `Create rule and link to ${entityType}`
							: "Create a new rule"}
					</DialogTitle>
				</DialogHeader>
				<div className="flex items-center overflow-y-auto">
					<FormBuilder
						alignment="vertical"
						fields={formFields}
						isLoading={isLoading}
						onSubmit={createRule}
						submitButtonText="Create rule"
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
