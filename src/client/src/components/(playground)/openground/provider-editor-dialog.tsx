"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import getMessage from "@/constants/messages";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";

export interface ProviderFormData {
	providerId: string;
	displayName: string;
	description: string;
	requiresVault: boolean;
}

interface ProviderEditorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	provider: ProviderFormData | null; // null = adding new
	onSaved: () => void;
}

export default function ProviderEditorDialog({
	open,
	onOpenChange,
	provider,
	onSaved,
}: ProviderEditorDialogProps) {
	const m = getMessage();
	const isEditing = !!provider;

	const [formData, setFormData] = useState<ProviderFormData>({
		providerId: "",
		displayName: "",
		description: "",
		requiresVault: true,
	});

	const { fireRequest, isLoading } = useFetchWrapper();

	useEffect(() => {
		if (provider) {
			setFormData(provider);
		} else {
			setFormData({
				providerId: "",
				displayName: "",
				description: "",
				requiresVault: true,
			});
		}
	}, [provider, open]);

	const handleSave = () => {
		if (!formData.providerId || !formData.displayName) {
			toast.error(
				`${m.MANAGE_PROVIDERS_ID_LABEL} and ${m.MANAGE_PROVIDERS_DISPLAY_NAME} are required`
			);
			return;
		}

		fireRequest({
			requestType: isEditing ? "PUT" : "POST",
			url: "/api/openground/providers",
			body: JSON.stringify(formData),
			successCb: () => {
				toast.success(m.MANAGE_PROVIDERS_SAVED, { id: "provider-save" });
				onOpenChange(false);
				onSaved();
			},
			failureCb: (err?: string) => {
				toast.error(err || m.MANAGE_PROVIDERS_SAVE_FAILED, {
					id: "provider-save",
				});
			},
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{isEditing ? m.MANAGE_PROVIDERS_EDIT : m.MANAGE_PROVIDERS_ADD}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? m.MANAGE_PROVIDERS_ID_HINT
							: m.MANAGE_PROVIDERS_ID_HINT}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="provider-id">{m.MANAGE_PROVIDERS_ID_LABEL}</Label>
						<Input
							id="provider-id"
							placeholder="my-provider"
							value={formData.providerId}
							onChange={(e) => {
								let v = e.target.value.toLowerCase().replace(/ /g, "-");
								v = v.replace(/[^a-z0-9-]/g, "");
								setFormData({ ...formData, providerId: v });
							}}
							disabled={isEditing}
						/>
						{!isEditing && (
							<p className="text-xs text-stone-500 dark:text-stone-400">
								{m.MANAGE_PROVIDERS_ID_HINT}
							</p>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor="display-name">
							{m.MANAGE_PROVIDERS_DISPLAY_NAME}
						</Label>
						<Input
							id="display-name"
							placeholder="My Provider"
							value={formData.displayName}
							onChange={(e) =>
								setFormData({ ...formData, displayName: e.target.value })
							}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="description">
							{m.MANAGE_PROVIDERS_DESCRIPTION}
						</Label>
						<Input
							id="description"
							placeholder="Custom LLM provider"
							value={formData.description}
							onChange={(e) =>
								setFormData({ ...formData, description: e.target.value })
							}
						/>
					</div>

					<div className="flex items-center justify-between rounded-lg border border-stone-200 dark:border-stone-700 p-4">
						<div className="space-y-0.5">
							<Label>{m.MANAGE_PROVIDERS_REQUIRES_VAULT}</Label>
						</div>
						<Switch
							checked={formData.requiresVault}
							onCheckedChange={(val) =>
								setFormData({ ...formData, requiresVault: val })
							}
						/>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{m.CANCEL}
					</Button>
					<Button onClick={handleSave} disabled={isLoading}>
						{isLoading
							? m.SAVING
							: isEditing
								? m.MANAGE_PROVIDERS_EDIT
								: m.MANAGE_PROVIDERS_ADD}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
