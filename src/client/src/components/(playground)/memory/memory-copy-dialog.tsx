"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import getMessage from "@/constants/messages";
import {
	emptyMemoryFilters,
	type MemoryCapabilities,
	type MemoryFilterField,
	type MemoryFilterOptions,
} from "@/lib/platform/connectors/memory/types";
import MemoryFilterCombobox, {
	memoryFilterChoices,
} from "./memory-filter-combobox";

export type MemoryCopyTarget = {
	id: string;
	name: string;
	type: string;
	environment?: string;
	capabilities?: MemoryCapabilities | null;
	filterFields?: MemoryFilterField[];
};

export type MemoryCopyScope = {
	userId?: string;
	sessionId?: string;
	agentId?: string;
};

type MemoryCopyDialogProps = {
	open: boolean;
	count: number;
	targets: MemoryCopyTarget[];
	filters?: MemoryFilterOptions;
	saving?: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: { targetConnectorId: string } & MemoryCopyScope) => void;
};

export default function MemoryCopyDialog({
	open,
	count,
	targets,
	filters = emptyMemoryFilters(),
	saving,
	onOpenChange,
	onSubmit,
}: MemoryCopyDialogProps) {
	const messages = getMessage();
	const [targetId, setTargetId] = useState(targets[0]?.id || "");
	const [userId, setUserId] = useState("");
	const [sessionId, setSessionId] = useState("");
	const [agentId, setAgentId] = useState("");

	useEffect(() => {
		if (!open) return;
		setTargetId((current) =>
			targets.some((target) => target.id === current) ? current : targets[0]?.id || ""
		);
		setUserId("");
		setSessionId("");
		setAgentId("");
	}, [open, targets]);

	const target = targets.find((item) => item.id === targetId);
	const filterFields = target?.filterFields || [];
	const missingRequired = filterFields.some((field) => {
		if (!field.required && !field.writeRequired) return false;
		return !fieldValue(field.key).trim();
	});
	const canSave = !!targetId && !saving && !missingRequired && count > 0;

	function fieldValue(key: MemoryFilterField["key"]): string {
		if (key === "userId") return userId;
		if (key === "sessionId") return sessionId;
		return agentId;
	}

	function setFieldValue(key: MemoryFilterField["key"], next: string) {
		if (key === "userId") setUserId(next);
		else if (key === "sessionId") setSessionId(next);
		else setAgentId(next);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{messages.MEMORY_COPY_TITLE}</DialogTitle>
					<DialogDescription>{messages.MEMORY_COPY_DESCRIPTION}</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					{targets.length === 0 ? (
						<p className="text-sm text-muted-foreground">{messages.MEMORY_COPY_NO_TARGETS}</p>
					) : (
						<div className="space-y-1.5">
							<Label>{messages.MEMORY_COPY_TARGET}</Label>
							<Select value={targetId} onValueChange={setTargetId} disabled={saving}>
								<SelectTrigger className="h-8" aria-label={messages.MEMORY_COPY_TARGET}>
									<SelectValue placeholder={messages.MEMORY_COPY_TARGET} />
								</SelectTrigger>
								<SelectContent>
									{targets.map((item) => (
										<SelectItem key={item.id} value={item.id}>
											{item.environment ? `${item.name} · ${item.environment}` : item.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
					{filterFields.map((field) => (
						<div key={field.key} className="space-y-1.5">
							<Label>{field.label}</Label>
							<MemoryFilterCombobox
								label={field.label}
								value={fieldValue(field.key)}
								options={memoryFilterChoices(field, filters, userId)}
								onChange={(next) => setFieldValue(field.key, next)}
								allowCustom={field.allowCustom !== false}
								disabled={saving}
								required={!!field.required || !!field.writeRequired}
								widthClass="w-full"
								inDialog
							/>
						</div>
					))}
				</div>
				<DialogFooter>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={saving}
						onClick={() => onOpenChange(false)}
					>
						{messages.MEMORY_CANCEL}
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={!canSave}
						onClick={() =>
							onSubmit({
								targetConnectorId: targetId,
								userId: userId.trim() || undefined,
								sessionId: sessionId.trim() || undefined,
								agentId: agentId.trim() || undefined,
							})
						}
					>
						{messages.MEMORY_COPY_SAVE}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
