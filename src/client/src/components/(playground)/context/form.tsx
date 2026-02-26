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
import { jsonParse } from "@/utils/json";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Context } from "@/types/context";

export default function ContextForm({
	contextData,
	children,
	successCallback,
}: {
	contextData?: Context;
	children: JSX.Element;
	successCallback?: () => void;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const { fireRequest, isLoading } = useFetchWrapper();

	const upsertContext: FormBuilderEvent = useCallback(
		(event, formdata) => {
			event.preventDefault();
			toast.loading(
				contextData?.id ? "Updating context..." : "Creating context...",
				{ id: "context" }
			);

			const payload: any = { ...formdata };
			if (contextData?.id) {
				payload.id = contextData.id;
			}

			fireRequest({
				body: JSON.stringify(payload),
				requestType: contextData?.id ? "PUT" : "POST",
				url: contextData?.id
					? `/api/context/${contextData.id}`
					: "/api/context",
				successCb: () => {
					toast.success(
						`${contextData?.id ? "Updated" : "Created"} context successfully!`,
						{ id: "context" }
					);
					setIsOpen(false);
					if (typeof successCallback === "function") {
						successCallback();
					}
				},
				failureCb: (err?: string) => {
					toast.error(
						err ||
							`${contextData?.id ? "Update" : "Creation"} of context failed!`,
						{ id: "context" }
					);
				},
			});
		},
		[contextData, successCallback]
	);

	const defaultTags = contextData?.tags ? jsonParse(contextData.tags) : [];

	const formFields: FieldProps[] = [
		{
			label: "Name",
			inputKey: `${contextData?.id || "new"}-name`,
			fieldType: "INPUT",
			fieldTypeProps: {
				type: "text",
				name: "name",
				placeholder: "My Context",
				defaultValue: contextData?.name || "",
			},
		},
		{
			label: "Content",
			description: "The context content (required)",
			inputKey: `${contextData?.id || "new"}-content`,
			fieldType: "TEXTAREA",
			fieldTypeProps: {
				name: "content",
				placeholder: "Enter context content...",
				defaultValue: contextData?.content || "",
				rows: 4,
			} as any,
		},
		{
			label: "Description",
			inputKey: `${contextData?.id || "new"}-description`,
			fieldType: "TEXTAREA",
			fieldTypeProps: {
				name: "description",
				placeholder: "Optional description",
				defaultValue: contextData?.description || "",
				rows: 2,
			} as any,
		},
		{
			label: "Tags",
			inputKey: `${contextData?.id || "new"}-tags`,
			fieldType: "TAGSINPUT",
			fieldTypeProps: {
				name: "tags",
				placeholder: "Add tags",
				defaultValue: defaultTags,
			},
		},
		{
			label: "Status",
			inputKey: `${contextData?.id || "new"}-status`,
			fieldType: "SELECT",
			fieldTypeProps: {
				name: "status",
				placeholder: "Select status",
				defaultValue: contextData?.status || "ACTIVE",
				options: [
					{ value: "ACTIVE", label: "Active" },
					{ value: "INACTIVE", label: "Inactive" },
				],
				onChange: () => {},
			} as any,
		},
	];

	return (
		<Dialog onOpenChange={setIsOpen} open={isOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="max-w-xl bg-white dark:bg-stone-950 border-stone-200 dark:border-stone-800">
				<DialogHeader>
					<DialogTitle className="text-stone-900 dark:text-stone-100">
						{contextData?.id ? "Update context" : "Create a new context"}
					</DialogTitle>
				</DialogHeader>
				<div className="flex items-center overflow-y-auto">
					<FormBuilder
						alignment="vertical"
						fields={formFields}
						isLoading={isLoading}
						onSubmit={upsertContext}
						submitButtonText={
							contextData?.id ? "Update context" : "Create context"
						}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
