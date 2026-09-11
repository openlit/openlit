"use client";

import { useEffect, useRef, useState } from "react";
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
import { getRequestHeaders } from "@/utils/api";
import {
	emptyMemoryFilters,
	type MemoryFilterField,
	type MemoryFilterKey,
	type MemoryFilterOptions,
} from "@/lib/platform/connectors/memory/types";
import {
	applyMemoryFilterChange,
	emptyMemoryFilterScope,
	keepDialogPopoverOpen,
	MemoryDialogFilterFields,
	memoryFilterRequiredMissing,
	trimmedMemoryFilterScope,
	type MemoryFilterScope,
} from "./memory-filter-fields";

export type MemoryCopyTarget = {
	id: string;
	name: string;
	type: string;
	environment?: string;
	capabilities?: { add?: boolean } | null;
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
	saving?: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: { targetConnectorId: string } & MemoryCopyScope) => void;
};

export default function MemoryCopyDialog({
	open,
	count,
	targets,
	saving,
	onOpenChange,
	onSubmit,
}: MemoryCopyDialogProps) {
	const messages = getMessage();
	const [targetId, setTargetId] = useState(targets[0]?.id || "");
	const [scope, setScope] = useState<MemoryFilterScope>(emptyMemoryFilterScope());
	const [filters, setFilters] = useState<MemoryFilterOptions>(emptyMemoryFilters());
	const [filterFields, setFilterFields] = useState<MemoryFilterField[]>([]);
	const [loadingFilters, setLoadingFilters] = useState(false);
	const targetsRef = useRef(targets);
	targetsRef.current = targets;

	useEffect(() => {
		if (!open) return;
		setTargetId((current) =>
			targets.some((target) => target.id === current) ? current : targets[0]?.id || ""
		);
	}, [open, targets]);

	useEffect(() => {
		if (!open || !targetId) {
			setFilters(emptyMemoryFilters());
			setFilterFields([]);
			setLoadingFilters(false);
			return;
		}
		const target = targetsRef.current.find((item) => item.id === targetId);
		setScope(emptyMemoryFilterScope());
		setFilters(emptyMemoryFilters());
		setFilterFields(target?.filterFields || []);
		const controller = new AbortController();
		setLoadingFilters(true);
		const params = new URLSearchParams({
			connectorId: targetId,
			limit: "1",
		});
		fetch(`/api/memory?${params.toString()}`, {
			signal: controller.signal,
			headers: getRequestHeaders(),
		})
			.then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					throw new Error(messages.MEMORY_LOAD_FAILED);
				}
				return body as {
					filters?: MemoryFilterOptions;
					filterFields?: MemoryFilterField[];
				};
			})
			.then((payload) => {
				setFilters(payload.filters || emptyMemoryFilters());
				if (payload.filterFields?.length) setFilterFields(payload.filterFields);
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				if (error instanceof DOMException && error.name === "AbortError") return;
				setFilters(emptyMemoryFilters());
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoadingFilters(false);
			});
		return () => controller.abort();
	}, [open, targetId, messages.MEMORY_LOAD_FAILED]);

	const canSave =
		!!targetId &&
		!saving &&
		!loadingFilters &&
		!memoryFilterRequiredMissing(filterFields, scope) &&
		count > 0;

	function setFieldValue(key: MemoryFilterKey, next: string) {
		setScope((current) => applyMemoryFilterChange(current, filters, key, next));
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-lg"
				onPointerDownOutside={keepDialogPopoverOpen}
				onInteractOutside={keepDialogPopoverOpen}
			>
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
					<MemoryDialogFilterFields
						fields={filterFields}
						filters={filters}
						scope={scope}
						onChange={setFieldValue}
						disabled={saving || loadingFilters}
					/>
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
								...trimmedMemoryFilterScope(scope),
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
