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
	type MemoryFilterOptions,
} from "@/lib/platform/connectors/memory/types";
import MemoryFilterCombobox, {
	memoryFilterChoices,
} from "./memory-filter-combobox";

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
	const initialScope = alignedWriteScope(scope, filters);
	const [draft, setDraft] = useState(content || "");
	const [userId, setUserId] = useState(initialScope.userId || "");
	const [sessionId, setSessionId] = useState(initialScope.sessionId || "");
	const [agentId, setAgentId] = useState(initialScope.agentId || "");

	useEffect(() => {
		if (!open) return;
		const next = alignedWriteScope(scope, filters);
		setDraft(content || "");
		setUserId(next.userId || "");
		setSessionId(next.sessionId || "");
		setAgentId(next.agentId || "");
		// Hydrate once when the dialog opens so parent list refreshes don't wipe edits.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const showScope = mode === "add" && filterFields.length > 0;
	const trimmed = draft.trim();
	const missingRequired = filterFields.some((field) => {
		if (mode !== "add" || (!field.required && !field.writeRequired)) return false;
		return !fieldValue(field.key).trim();
	});
	const canSave = !!trimmed && !saving && !missingRequired;

	function fieldValue(key: MemoryFilterField["key"]): string {
		if (key === "userId") return userId;
		if (key === "sessionId") return sessionId;
		return agentId;
	}

	function setFieldValue(key: MemoryFilterField["key"], next: string) {
		if (key === "userId") {
			setUserId(next);
			if (
				sessionId &&
				!filters.sessions.some(
					(session) =>
						session.id === sessionId && (!session.userId || session.userId === next)
				)
			) {
				setSessionId("");
			}
			return;
		}
		if (key === "sessionId") {
			setSessionId(next);
			const session = filters.sessions.find((item) => item.id === next);
			if (session?.userId && session.userId !== userId) {
				setUserId(session.userId);
			}
			return;
		}
		setAgentId(next);
	}

	function handleSubmit() {
		if (!canSave) return;
		onSubmit({
			content: trimmed,
			userId: userId.trim() || undefined,
			sessionId: sessionId.trim() || undefined,
			agentId: agentId.trim() || undefined,
		});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-lg"
				onPointerDownOutside={(event) => {
					const target = event.target as HTMLElement | null;
					if (target?.closest("[data-radix-popper-content-wrapper]")) {
						event.preventDefault();
					}
				}}
				onInteractOutside={(event) => {
					const target = event.target as HTMLElement | null;
					if (target?.closest("[data-radix-popper-content-wrapper]")) {
						event.preventDefault();
					}
				}}
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
					{showScope
						? filterFields.map((field) => (
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
							))
						: null}
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
): MemoryWriteScope {
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
