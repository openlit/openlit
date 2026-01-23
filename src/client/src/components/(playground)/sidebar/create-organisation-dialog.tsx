"use client";
import { useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrganisation } from "@/helpers/client/organisation";

interface CreateOrganisationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: () => void;
}

export default function CreateOrganisationDialog({
	open,
	onOpenChange,
	onSuccess,
}: CreateOrganisationDialogProps) {
	const [name, setName] = useState("");
	const [isLoading, setIsLoading] = useState(false);

	const handleCreate = async () => {
		if (!name.trim()) return;

		setIsLoading(true);
		const result = await createOrganisation(name.trim());
		setIsLoading(false);

		if (result) {
			setName("");
			onOpenChange(false);
			onSuccess?.();
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Create Organisation</DialogTitle>
					<DialogDescription>
						Create a new organisation to manage your databases and team members.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="name">Organisation Name</Label>
						<Input
							id="name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My Organisation"
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									handleCreate();
								}
							}}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleCreate} disabled={!name.trim() || isLoading}>
						{isLoading ? "Creating..." : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
