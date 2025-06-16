import { DialogTitle } from "@/components/ui/dialog";
import { DialogHeader } from "@/components/ui/dialog";
import { DialogContent } from "@/components/ui/dialog";
import { FieldProps, FormBuilderEvent } from "@/types/form";
import { DashboardItemType } from "@/types/manage-dashboard";
import { useCallback } from "react";
import { Dialog } from "@/components/ui/dialog";
import FormBuilder from "@/components/common/form-builder";
import { toast } from "sonner";

export default function AddEditDialog({
	isOpen,
	onOpenChange,
	mode,
	initialItemTitle = "",
	initialItemDescription = "",
	initialItemType = "board",
	initialItemTags = [],
	onSave,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	mode: "add" | "edit";
	initialItemTitle?: string;
	initialItemDescription?: string;
	initialItemType?: DashboardItemType;
	initialItemTags?: string[];
	onSave: (title: string, description: string, type: DashboardItemType, tags: string[]) => void;
	onCancel: () => void;
}) {
	const handleSubmit: FormBuilderEvent = useCallback(
		(event, formdata) => {
			event.preventDefault();
			
			// Validate that title is not empty
			if (!formdata.title || formdata.title.trim() === '') {
				toast.error('Please enter a title. Title cannot be empty.');
				return;
			}
			
			onSave(
				formdata.title.trim(),
				formdata.description,
				formdata.type as DashboardItemType,
				formdata.tags
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
		{
			label: "Tags",
			inputKey: `item-tags`,
			fieldType: "TAGSINPUT",
			fieldTypeProps: {
				name: "tags",
				placeholder: "Add tags",
				defaultValue: initialItemTags,
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
						subText: "Container for dashboards and other folders",
						value: "folder",
						description: "Create a new folder to organize your dashboards",
					},
					{
						title: "Dashboard",
						subText: "Dashboard with widgets",
						value: "board",
						description: "Create a new dashboard",
					},
				],
			},
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85%] overflow-hidden">
				<DialogHeader>
					<DialogTitle>
						{mode === "add" ? "Create New Dashboard/Folder" : "Edit Dashboard/Folder"}
					</DialogTitle>
				</DialogHeader>
				<div className="flex items-center overflow-y-auto mt-4">
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
