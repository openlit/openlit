import { DialogTitle } from "@/components/ui/dialog";
import { DialogHeader } from "@/components/ui/dialog";
import { DialogContent } from "@/components/ui/dialog";
import { FieldProps, FormBuilderEvent } from "@/types/form";
import { DashboardItemType } from "@/types/manage-dashboard";
import { useCallback } from "react";
import { Dialog } from "@/components/ui/dialog";
import FormBuilder from "@/components/common/form-builder";

export default function AddEditDialog({
	isOpen,
	onOpenChange,
	mode,
	initialItemTitle = "",
	initialItemDescription = "",
	initialItemType = "board",
	onSave,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	mode: "add" | "edit";
	initialItemTitle?: string;
	initialItemDescription?: string;
	initialItemType?: DashboardItemType;
	onSave: (title: string, description: string, type: DashboardItemType) => void;
	onCancel: () => void;
}) {
	const handleSubmit: FormBuilderEvent = useCallback(
		(event, formdata) => {
			event.preventDefault();
			onSave(
				formdata.title,
				formdata.description,
				formdata.type as DashboardItemType
			);
		},
		[onSave]
	);

	// Define form fields
	const formFields: FieldProps[] = [
		{
			label: "Title",
			description: "Enter a title for your item",
			inputKey: "item-title",
			fieldType: "INPUT",
			fieldTypeProps: {
				type: "text",
				name: "title",
				placeholder: "Enter title",
				defaultValue: initialItemTitle,
			},
		},
		{
			label: "Description",
			description: "Enter a description for your item",
			inputKey: "item-description",
			fieldType: "TEXTAREA",
			fieldTypeProps: {
				type: "text",
				name: "description",
				placeholder: "Enter description",
				defaultValue: initialItemDescription,
			},
		},
	];

	// Add type selection field only for add mode
	if (mode === "add") {
		formFields.push({
			label: "Type",
			inputKey: "item-type",
			fieldType: "RADIOGROUP",
			fieldTypeProps: {
				name: "type",
				placeholder: "Select type",
				defaultValue: initialItemType,
				options: [
					{
						title: "Folder",
						subText: "Container for boards and other folders",
						value: "folder",
						description: "Create a new folder to organize your boards",
					},
					{
						title: "Board",
						subText: "Dashboard with widgets",
						value: "board",
						description: "Create a new dashboard board",
					},
				],
			},
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{mode === "add" ? "Add New Item" : "Edit Item"}
					</DialogTitle>
				</DialogHeader>
				<div className="flex items-center overflow-y-auto">
					<FormBuilder
						alignment="vertical"
						fields={formFields}
						onSubmit={handleSubmit}
						submitButtonText={mode === "add" ? "Add" : "Save"}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
