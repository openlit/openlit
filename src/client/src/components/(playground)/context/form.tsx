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
import getMessage from "@/constants/messages";

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
	const m = getMessage();

	const upsertContext: FormBuilderEvent = useCallback(
		(event, formdata) => {
			event.preventDefault();
			toast.loading(
				contextData?.id ? m.CONTEXT_UPDATING : m.CONTEXT_CREATING,
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
						contextData?.id ? m.CONTEXT_UPDATED_SUCCESS : m.CONTEXT_CREATED_SUCCESS,
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
							(contextData?.id ? m.CONTEXT_UPDATE_FAILED : m.CONTEXT_CREATE_FAILED),
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
			label: m.CONTEXT_NAME,
			inputKey: `${contextData?.id || "new"}-name`,
			fieldType: "INPUT",
			fieldTypeProps: {
				type: "text",
				name: "name",
				placeholder: m.CONTEXT_NAME_PLACEHOLDER,
				defaultValue: contextData?.name || "",
			},
		},
		{
			label: m.CONTEXT_CONTENT,
			description: m.CONTEXT_CONTENT_HINT,
			inputKey: `${contextData?.id || "new"}-content`,
			fieldType: "TEXTAREA",
			fieldTypeProps: {
				name: "content",
				placeholder: m.CONTEXT_CONTENT_PLACEHOLDER,
				defaultValue: contextData?.content || "",
				rows: 4,
			} as any,
		},
		{
			label: m.DESCRIPTION,
			inputKey: `${contextData?.id || "new"}-description`,
			fieldType: "TEXTAREA",
			fieldTypeProps: {
				name: "description",
				placeholder: m.CONTEXT_DESCRIPTION_PLACEHOLDER,
				defaultValue: contextData?.description || "",
				rows: 2,
			} as any,
		},
		{
			label: m.TAGS,
			inputKey: `${contextData?.id || "new"}-tags`,
			fieldType: "TAGSINPUT",
			fieldTypeProps: {
				name: "tags",
				placeholder: m.CONTEXT_TAGS_PLACEHOLDER,
				defaultValue: defaultTags,
			},
		},
		{
			label: m.STATUS,
			inputKey: `${contextData?.id || "new"}-status`,
			fieldType: "SELECT",
			fieldTypeProps: {
				name: "status",
				placeholder: m.CONTEXT_STATUS_PLACEHOLDER,
				defaultValue: contextData?.status || "ACTIVE",
				options: [
					{ value: "ACTIVE", label: m.CONTEXT_STATUS_ACTIVE },
					{ value: "INACTIVE", label: m.CONTEXT_STATUS_INACTIVE },
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
						{contextData?.id ? m.CONTEXT_UPDATE : m.CONTEXT_CREATE_NEW}
					</DialogTitle>
				</DialogHeader>
				<div className="flex items-center overflow-y-auto">
					<FormBuilder
						alignment="vertical"
						fields={formFields}
						isLoading={isLoading}
						onSubmit={upsertContext}
						submitButtonText={
							contextData?.id ? m.CONTEXT_UPDATE : m.CONTEXT_CREATE
						}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
