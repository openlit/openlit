"use client";

import { Label } from "@/components/ui/label";
import {
	type MemoryFilterField,
	type MemoryFilterKey,
	type MemoryFilterOptions,
} from "@/lib/platform/connectors/memory/types";
import MemoryFilterCombobox, {
	memoryFilterChoices,
} from "./memory-filter-combobox";

export type MemoryFilterScope = {
	userId: string;
	sessionId: string;
	agentId: string;
};

export function emptyMemoryFilterScope(): MemoryFilterScope {
	return { userId: "", sessionId: "", agentId: "" };
}

export function memoryFilterValue(
	scope: MemoryFilterScope,
	key: MemoryFilterKey
): string {
	if (key === "userId") return scope.userId;
	if (key === "sessionId") return scope.sessionId;
	return scope.agentId;
}

export function applyMemoryFilterChange(
	scope: MemoryFilterScope,
	filters: MemoryFilterOptions,
	key: MemoryFilterKey,
	next: string
): MemoryFilterScope {
	if (key === "userId") {
		const sessionStillValid =
			!scope.sessionId ||
			filters.sessions.some(
				(session) =>
					session.id === scope.sessionId &&
					(!session.userId || session.userId === next)
			);
		return {
			...scope,
			userId: next,
			sessionId: sessionStillValid ? scope.sessionId : "",
		};
	}
	if (key === "sessionId") {
		const session = filters.sessions.find((item) => item.id === next);
		return {
			...scope,
			sessionId: next,
			userId:
				session?.userId && session.userId !== scope.userId
					? session.userId
					: scope.userId,
		};
	}
	return { ...scope, agentId: next };
}

export function memoryFilterRequiredMissing(
	fields: MemoryFilterField[],
	scope: MemoryFilterScope
): boolean {
	return fields.some((field) => {
		if (!field.required && !field.writeRequired) return false;
		return !memoryFilterValue(scope, field.key).trim();
	});
}

export function trimmedMemoryFilterScope(scope: MemoryFilterScope) {
	return {
		userId: scope.userId.trim() || undefined,
		sessionId: scope.sessionId.trim() || undefined,
		agentId: scope.agentId.trim() || undefined,
	};
}

export function keepDialogPopoverOpen(event: {
	target: EventTarget | null;
	preventDefault: () => void;
}) {
	const target = event.target as HTMLElement | null;
	if (target?.closest("[data-radix-popper-content-wrapper]")) {
		event.preventDefault();
	}
}

export function MemoryDialogFilterFields({
	fields,
	filters,
	scope,
	onChange,
	disabled,
}: {
	fields: MemoryFilterField[];
	filters: MemoryFilterOptions;
	scope: MemoryFilterScope;
	onChange: (key: MemoryFilterKey, next: string) => void;
	disabled?: boolean;
}) {
	return (
		<>
			{fields.map((field) => (
				<div key={field.key} className="space-y-1.5">
					<Label>{field.label}</Label>
					<MemoryFilterCombobox
						label={field.label}
						value={memoryFilterValue(scope, field.key)}
						options={memoryFilterChoices(field, filters, scope.userId)}
						onChange={(next) => onChange(field.key, next)}
						allowCustom={field.allowCustom !== false}
						disabled={disabled}
						required={!!field.required || !!field.writeRequired}
						widthClass="w-full"
						inDialog
					/>
				</div>
			))}
		</>
	);
}
