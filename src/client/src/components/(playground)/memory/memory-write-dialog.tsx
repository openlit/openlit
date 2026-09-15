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
import { Textarea } from "@/components/ui/textarea";
import getMessage from "@/constants/messages";
import {
	emptyMemoryFilters,
	MEMORY_CONTENT_MAX,
	type MemoryFilterField,
	type MemoryFilterKey,
	type MemoryFilterOptions,
} from "@/lib/platform/connectors/memory/types";
import {
	applyMemoryFilterChange,
	keepDialogPopoverOpen,
	MemoryDialogFilterFields,
	memoryFilterRequiredMissing,
	trimmedMemoryFilterScope,
	type MemoryFilterScope,
} from "./memory-filter-fields";

export type MemoryWriteScope = {
	userId?: string;
	sessionId?: string;
	agentId?: string;
};

type MemoryWriteDialogProps = {
	open: boolean;
	mode: "add" | "edit";
	content?: string;
	scope?: MemoryWriteScope;
	filterFields?: MemoryFilterField[];
	filters?: MemoryFilterOptions;
	saving?: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: { content: string } & MemoryWriteScope) => void;
};

export default function MemoryWriteDialog({
	open,
	mode,
	content,
	scope,
	filterFields = [],
	filters = emptyMemoryFilters(),
	saving,
	onOpenChange,
	onSubmit,
}: MemoryWriteDialogProps) {
	const messages = getMessage();
	const [draft, setDraft] = useState(content || "");
	const [filterScope, setFilterScope] = useState<MemoryFilterScope>(() =>
		alignedWriteScope(scope, filters)
	);

	useEffect(() => {
		if (!open) return;
		setDraft(content || "");
		setFilterScope(alignedWriteScope(scope, filters));
		// Hydrate once when the dialog opens so parent list refreshes don't wipe edits.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const showScope = mode === "add" && filterFields.length > 0;
	const trimmed = draft.trim();
	const missingRequired =
		mode === "add" && memoryFilterRequiredMissing(filterFields, filterScope);
	const canSave = !!trimmed && !saving && !missingRequired;

	function setFieldValue(key: MemoryFilterKey, next: string) {
		setFilterScope((current) => applyMemoryFilterChange(current, filters, key, next));
	}

	function handleSubmit() {
		if (!canSave) return;
		onSubmit({
			content: trimmed,
			...trimmedMemoryFilterScope(filterScope),
		});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-lg"
				onPointerDownOutside={keepDialogPopoverOpen}
				onInteractOutside={keepDialogPopoverOpen}
			>
				<DialogHeader>
					<DialogTitle>
						{mode === "add" ? messages.MEMORY_ADD_TITLE : messages.MEMORY_EDIT_TITLE}
					</DialogTitle>
					{mode === "add" ? (
						<DialogDescription>{messages.MEMORY_ADD_DESCRIPTION}</DialogDescription>
					) : null}
				</DialogHeader>
				<div className="space-y-3">
					<div className="space-y-1.5">
						<Label htmlFor="memory-content">{messages.MEMORY_DETAIL_MEMORY}</Label>
						<Textarea
							id="memory-content"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							placeholder={messages.MEMORY_ADD_PLACEHOLDER}
							maxLength={MEMORY_CONTENT_MAX}
							disabled={saving}
							className="min-h-[140px] text-sm text-stone-900 dark:text-stone-100"
						/>
					</div>
					{showScope ? (
						<MemoryDialogFilterFields
							fields={filterFields}
							filters={filters}
							scope={filterScope}
							onChange={setFieldValue}
							disabled={saving}
						/>
					) : null}
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
					<Button type="button" size="sm" disabled={!canSave} onClick={handleSubmit}>
						{mode === "add" ? messages.MEMORY_ADD_SAVE : messages.MEMORY_EDIT_SAVE}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function alignedWriteScope(
	scope: MemoryWriteScope | undefined,
	filters: MemoryFilterOptions
): MemoryFilterScope {
	const userId = scope?.userId?.trim() || "";
	const sessionId = scope?.sessionId?.trim() || "";
	const agentId = scope?.agentId?.trim() || "";
	const userIds = new Set(filters.users.map((item) => item.id));
	const sessionIds = new Set(filters.sessions.map((item) => item.id));
	const userIsSession = !!userId && sessionIds.has(userId) && !userIds.has(userId);
	const sessionIsUser = !!sessionId && userIds.has(sessionId) && !sessionIds.has(sessionId);
	if (!userIsSession && !sessionIsUser) {
		return { userId, sessionId, agentId };
	}
	return {
		userId: sessionIsUser
			? sessionId
			: userIsSession
				? filters.sessions.find((item) => item.id === userId)?.userId || ""
				: userId,
		sessionId: userIsSession ? userId : sessionIsUser ? "" : sessionId,
		agentId,
	};
}
