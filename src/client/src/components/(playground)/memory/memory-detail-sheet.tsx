"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Angry, ArrowRightLeft, ChevronDown, ChevronUp, Copy, Pencil, ThumbsDown, ThumbsUp, Trash2, User, X } from "lucide-react";
import { toast } from "sonner";
import FeatureAccess from "@/components/rbac/feature-access";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import getMessage from "@/constants/messages";
import { formatBrowserDateTime, formatDatePartsValue } from "@/utils/date";
import { getRequestHeaders } from "@/utils/api";
import type { MemoryDetailResult, MemoryListItem } from "@/lib/platform/connectors/memory/read";
import type { MemoryKind } from "@/lib/platform/connectors/memory/graph";
import type {
	MemoryCapabilities,
	MemoryFeedback,
	MemoryFeedbackRating,
	MemoryHistoryEvent,
	MemoryMessage,
} from "@/lib/platform/connectors/memory/types";
import MemoryWriteDialog from "./memory-write-dialog";

const DETAIL_SHEET_CONTENT_CLASS =
	"right-2 top-2 bottom-2 flex h-auto w-auto max-w-none flex-col gap-0 border-0 bg-transparent p-0 shadow-none focus-visible:outline-none sm:max-w-none";

const KIND_DOT: Record<MemoryKind, string> = {
	temporal: "bg-teal-500",
	profile: "bg-orange-500",
	summary: "bg-lime-500",
};

const CATEGORY_DOTS = [
	"bg-sky-500",
	"bg-pink-500",
	"bg-violet-500",
	"bg-teal-500",
	"bg-orange-500",
	"bg-lime-500",
];

type MemoryDetailSheetProps = {
	open: boolean;
	memoryId: string | null;
	memoryIds?: string[];
	connectorId?: string;
	capabilities?: MemoryCapabilities | null;
	preview?: MemoryListItem | null;
	onSelect?: (id: string) => void;
	onClose: () => void;
	onChanged?: () => void;
	onCopy?: (id: string) => void;
	onOpenSource?: (connectorId: string, memoryId: string) => void;
};

export default function MemoryDetailSheet({
	open,
	memoryId,
	memoryIds = [],
	connectorId,
	capabilities,
	preview,
	onSelect,
	onClose,
	onChanged,
	onCopy,
	onOpenSource,
}: MemoryDetailSheetProps) {
	const messages = getMessage();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hint, setHint] = useState<MemoryDetailResult["hint"]>();
	const [detail, setDetail] = useState<MemoryListItem | null>(preview || null);
	const [connectorName, setConnectorName] = useState<string>("");
	const [canFeedback, setCanFeedback] = useState(false);
	const [canUpdate, setCanUpdate] = useState(!!capabilities?.update);
	const [canDelete, setCanDelete] = useState(!!capabilities?.delete);
	const [editOpen, setEditOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const suppressSheetDismissRef = useRef(false);

	useEffect(() => {
		if (!open || !memoryId) {
			setError(null);
			setHint(undefined);
			setDetail(null);
			setCanFeedback(false);
			setCanUpdate(!!capabilities?.update);
			setCanDelete(!!capabilities?.delete);
			setEditOpen(false);
			setDeleteOpen(false);
			setLoading(false);
			return;
		}
		const controller = new AbortController();
		setLoading(true);
		setError(null);
		setHint(undefined);
		setDetail((current) =>
			current?.id === memoryId ? current : preview?.id === memoryId ? preview : null
		);
		const params = new URLSearchParams();
		if (connectorId) params.set("connectorId", connectorId);
		fetch(`/api/memory/${encodeURIComponent(memoryId)}?${params.toString()}`, {
			signal: controller.signal,
			headers: getRequestHeaders(),
		})
			.then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					const message =
						typeof body === "string"
							? body
							: body?.err || body?.error || messages.MEMORY_DETAIL_LOAD_FAILED;
					const notFound =
						response.status === 404 || message === messages.MEMORY_DETAIL_NOT_FOUND;
					if (notFound && preview?.id === memoryId) {
						return { memory: preview } as MemoryDetailResult;
					}
					throw new Error(message);
				}
				return body as MemoryDetailResult;
			})
			.then((payload) => {
				setHint(payload.hint);
				setConnectorName(payload.connector?.name ? String(payload.connector.name) : "");
				setCanFeedback(!!payload.capabilities?.feedback);
				setCanUpdate(!!(payload.capabilities?.update ?? capabilities?.update));
				setCanDelete(!!(payload.capabilities?.delete ?? capabilities?.delete));
				if (payload.memory) setDetail(payload.memory);
			})
			.catch((caught: unknown) => {
				if ((caught as { name?: string })?.name === "AbortError") return;
				setError(
					caught instanceof Error ? caught.message : messages.MEMORY_DETAIL_LOAD_FAILED
				);
			})
			.finally(() => setLoading(false));
		return () => controller.abort();
	}, [capabilities?.delete, capabilities?.update, connectorId, memoryId, messages.MEMORY_DETAIL_LOAD_FAILED, open, preview]);

	const memory = detail || preview;
	const title = memory?.content?.trim() || messages.MEMORY_DETAIL_TITLE;
	const index = memoryId ? memoryIds.indexOf(memoryId) : -1;
	const prevId = index > 0 ? memoryIds[index - 1] : undefined;
	const nextId =
		index >= 0 && index < memoryIds.length - 1 ? memoryIds[index + 1] : undefined;
	const inputCount = memory?.input?.length || 0;
	const changelogCount = memory?.history?.length || 0;

	function handleUpdate(input: { content: string }) {
		if (!memoryId || saving) return;
		setSaving(true);
		const params = new URLSearchParams();
		if (connectorId) params.set("connectorId", connectorId);
		fetch(`/api/memory/${encodeURIComponent(memoryId)}?${params.toString()}`, {
			method: "PATCH",
			headers: getRequestHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ content: input.content }),
		})
			.then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					throw new Error(apiError(body, messages.MEMORY_EDIT_FAILED));
				}
				return body as MemoryDetailResult;
			})
			.then((payload) => {
				if (payload.memory) setDetail(payload.memory);
				toast.success(messages.MEMORY_EDIT_SAVED);
				setEditOpen(false);
				onChanged?.();
			})
			.catch((caught: unknown) => {
				toast.error(
					caught instanceof Error ? caught.message : messages.MEMORY_EDIT_FAILED
				);
			})
			.finally(() => setSaving(false));
	}

	function handleDelete() {
		if (!memoryId || saving) return;
		setSaving(true);
		const params = new URLSearchParams();
		if (connectorId) params.set("connectorId", connectorId);
		fetch(`/api/memory/${encodeURIComponent(memoryId)}?${params.toString()}`, {
			method: "DELETE",
			headers: getRequestHeaders(),
		})
			.then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					throw new Error(apiError(body, messages.MEMORY_DELETE_FAILED));
				}
			})
			.then(() => {
				toast.success(messages.MEMORY_DELETED);
				setDeleteOpen(false);
				onClose();
				onChanged?.();
			})
			.catch((caught: unknown) => {
				toast.error(
					caught instanceof Error ? caught.message : messages.MEMORY_DELETE_FAILED
				);
			})
			.finally(() => setSaving(false));
	}

	function dismissBlocked() {
		if (suppressSheetDismissRef.current || editOpen || deleteOpen) return true;
		if (typeof document === "undefined") return false;
		return (
			document.querySelectorAll('[role="dialog"][data-state="open"]').length > 1 ||
			!!document.querySelector('[role="alertdialog"][data-state="open"]')
		);
	}

	function openNestedDialog(setter: (open: boolean) => void) {
		suppressSheetDismissRef.current = true;
		setter(true);
	}

	function onNestedOpenChange(
		setter: (open: boolean) => void,
		next: boolean
	) {
		setter(next);
		if (next) {
			suppressSheetDismissRef.current = true;
			return;
		}
		window.setTimeout(() => {
			suppressSheetDismissRef.current = false;
		}, 50);
	}

	return (
		<>
		<Sheet
			modal={false}
			open={open}
			onOpenChange={(next) => {
				if (!next && dismissBlocked()) return;
				if (!next) onClose();
			}}
		>
			<SheetContent
				side="right"
				className={DETAIL_SHEET_CONTENT_CLASS}
				displayOverlay={false}
				displayClose={false}
				onPointerDownOutside={(event) => {
					if (dismissBlocked()) event.preventDefault();
				}}
				onFocusOutside={(event) => {
					if (dismissBlocked()) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (dismissBlocked()) event.preventDefault();
				}}
			>
				<ResizableDetailSheet>
					<div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
						<div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
							<div className="min-w-0 flex-1">
								<h2 className="line-clamp-3 text-base font-semibold text-stone-950 dark:text-stone-50">
									{title}
								</h2>
								<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400">
									<HeaderMeta
										label={messages.MEMORY_DETAIL_CREATED}
										value={formatBrowserDateTime(memory?.createdAt, "")}
									/>
									<HeaderMeta
										label={messages.MEMORY_DETAIL_UPDATED}
										value={formatBrowserDateTime(memory?.updatedAt, "")}
									/>
									{memory?.id ? (
										<span className="inline-flex items-center gap-1 font-mono">
											<span className="font-sans">{messages.MEMORY_DETAIL_ID}:</span>
											{truncateId(memory.id)}
											<button
												type="button"
												className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
												title={messages.MEMORY_DETAIL_COPY_ID}
												onClick={() => copyMemoryId(memory.id, messages.COPIED_TO_CLIPBOARD)}
											>
												<Copy className="h-3 w-3" />
											</button>
										</span>
									) : null}
								</div>
								{memory?.userId ? (
									<p className="mt-2 flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300">
										<span>{messages.MEMORY_DETAIL_USER}</span>
										<User className="h-3.5 w-3.5 text-stone-400" />
										<span className="font-semibold text-stone-900 dark:text-stone-100">
											{memory.userId}
										</span>
									</p>
								) : null}
								{memory?.port ? (
									<p className="mt-2 text-xs text-violet-700 dark:text-violet-300">
										<span>{messages.MEMORY_COPY_SOURCE}</span>
										{" · "}
										<button
											type="button"
											className="font-medium underline underline-offset-2"
											onClick={() =>
												onOpenSource?.(
													memory.port!.sourceConnectorId,
													memory.port!.sourceMemoryId
												)
											}
										>
											{memory.port.sourceConnectorName || memory.port.sourceConnectorId}
										</button>
									</p>
								) : null}
							</div>
							<div className="flex shrink-0 items-center gap-1">
								<FeatureAccess access="memory.create" hideWhenDenied>
									{onCopy && memory?.id ? (
										<Button
											variant="outline"
											size="sm"
											className="h-7 w-7 border-stone-200 bg-white p-0 text-stone-600 hover:bg-stone-100 hover:text-stone-950 disabled:opacity-40 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												onCopy(memory.id);
											}}
											disabled={!memory || saving}
											title={messages.MEMORY_COPY}
										>
											<ArrowRightLeft className="h-3.5 w-3.5" />
										</Button>
									) : null}
								</FeatureAccess>
								<FeatureAccess access="memory.update" hideWhenDenied>
									{canUpdate ? (
										<Button
											variant="outline"
											size="sm"
											className="h-7 w-7 border-stone-200 bg-white p-0 text-stone-600 hover:bg-stone-100 hover:text-stone-950 disabled:opacity-40 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												openNestedDialog(setEditOpen);
											}}
											disabled={!memory || saving}
											title={messages.MEMORY_EDIT}
										>
											<Pencil className="h-3.5 w-3.5" />
										</Button>
									) : null}
								</FeatureAccess>
								<FeatureAccess access="memory.delete" hideWhenDenied>
									{canDelete ? (
										<Button
											variant="outline"
											size="sm"
											className="h-7 w-7 border-stone-200 bg-white p-0 text-stone-600 hover:bg-stone-100 hover:text-error disabled:opacity-40 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800"
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												openNestedDialog(setDeleteOpen);
											}}
											disabled={!memoryId || saving}
											title={messages.MEMORY_DELETE}
										>
											<Trash2 className="h-3.5 w-3.5" />
										</Button>
									) : null}
								</FeatureAccess>
								<Button
									variant="outline"
									size="sm"
									className="h-7 w-7 border-stone-200 bg-white p-0 text-stone-600 hover:bg-stone-100 hover:text-stone-950 disabled:opacity-40 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
									onClick={() => prevId && onSelect?.(prevId)}
									disabled={!prevId}
									title={messages.MEMORY_DETAIL_PREVIOUS}
								>
									<ChevronUp className="h-4 w-4" />
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="h-7 w-7 border-stone-200 bg-white p-0 text-stone-600 hover:bg-stone-100 hover:text-stone-950 disabled:opacity-40 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
									onClick={() => nextId && onSelect?.(nextId)}
									disabled={!nextId}
									title={messages.MEMORY_DETAIL_NEXT}
								>
									<ChevronDown className="h-4 w-4" />
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="h-7 w-7 border-stone-200 bg-white p-0 text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50"
									onClick={onClose}
									title={messages.OBSERVABILITY_CLOSE}
								>
									<X className="h-4 w-4" />
								</Button>
							</div>
						</div>
						<div className="min-h-0 flex-1 overflow-auto p-4">
							{hint === "get_unsupported" && preview ? (
								<p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
									{messages.MEMORY_DETAIL_UNSUPPORTED}
								</p>
							) : null}
							{error && !memory ? (
								<div className="rounded-md border border-error/30 bg-error/5 p-3 dark:bg-error/10">
									<p className="text-sm font-semibold text-error">
										{messages.MEMORY_DETAIL_LOAD_FAILED}
									</p>
									<p className="mt-1 text-xs text-muted-foreground">{error}</p>
								</div>
							) : null}
							{error && memory ? (
								<p className="mb-3 text-xs text-error">{error}</p>
							) : null}
							{loading && !memory ? (
								<div className="space-y-2">
									<Skeleton className="h-16 rounded-md" />
									<Skeleton className="h-32 rounded-md" />
								</div>
							) : memory ? (
								<Tabs key={memory.id} defaultValue="details" className="min-w-0">
									<TabsList className="h-9 w-max min-w-full justify-start rounded-md bg-stone-100 p-1 dark:bg-stone-900">
										<TabsTrigger value="details" className="shrink-0 px-3 py-1 text-xs">
											{messages.MEMORY_DETAIL_TAB_DETAILS}
										</TabsTrigger>
										{inputCount ? (
											<TabsTrigger value="input" className="shrink-0 px-3 py-1 text-xs">
												{messages.MEMORY_DETAIL_TAB_INPUT}
												{` (${inputCount})`}
											</TabsTrigger>
										) : null}
										{changelogCount ? (
											<TabsTrigger value="changelog" className="shrink-0 px-3 py-1 text-xs">
												{messages.MEMORY_DETAIL_TAB_CHANGELOG}
												{` (${changelogCount})`}
											</TabsTrigger>
										) : null}
									</TabsList>
									<TabsContent value="details" className="mt-3">
										<MemoryDetailsTab
											memory={memory}
											connectorName={connectorName}
											connectorId={connectorId}
											canFeedback={canFeedback}
											onFeedback={(feedback) =>
												setDetail((current) =>
													current
														? { ...current, feedback }
														: { ...memory, feedback }
												)
											}
										/>
									</TabsContent>
									{inputCount ? (
										<TabsContent value="input" className="mt-3">
											<MemoryInputTab messages={memory.input || []} />
										</TabsContent>
									) : null}
									{changelogCount ? (
										<TabsContent value="changelog" className="mt-3">
											<MemoryChangelogTab events={memory.history || []} />
										</TabsContent>
									) : null}
								</Tabs>
							) : null}
						</div>
					</div>
				</ResizableDetailSheet>
			</SheetContent>
		</Sheet>
			<MemoryWriteDialog
				open={editOpen}
				mode="edit"
				content={memory?.content}
				saving={saving}
				onOpenChange={(next) => onNestedOpenChange(setEditOpen, next)}
				onSubmit={handleUpdate}
			/>
			<AlertDialog
				open={deleteOpen}
				onOpenChange={(next) => onNestedOpenChange(setDeleteOpen, next)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{messages.MEMORY_DELETE_TITLE}</AlertDialogTitle>
						<AlertDialogDescription>
							{messages.MEMORY_DELETE_DESCRIPTION}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={saving} size="sm">
							{messages.MEMORY_CANCEL}
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={saving}
							variant="destructive"
							size="sm"
							onClick={(event) => {
								event.preventDefault();
								handleDelete();
							}}
						>
							{messages.MEMORY_DELETE_CONFIRM}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function MemoryDetailsTab({
	memory,
	connectorName,
	connectorId,
	canFeedback,
	onFeedback,
}: {
	memory: MemoryListItem;
	connectorName?: string;
	connectorId?: string;
	canFeedback?: boolean;
	onFeedback?: (feedback: MemoryFeedback) => void;
}) {
	const messages = getMessage();
	const kindLabel = kindMessage(messages, memory.kind);
	return (
		<div className="space-y-4">
			<section>
				<h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
					{messages.MEMORY_DETAIL_MEMORY}
				</h3>
				<p className="whitespace-pre-wrap rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
					{memory.content}
				</p>
			</section>
			{canFeedback ? (
				<FeatureAccess access="memory.feedback" hideWhenDenied>
					<MemoryFeedbackPanel
						memoryId={memory.id}
						connectorId={connectorId}
						feedback={memory.feedback}
						onFeedback={onFeedback}
					/>
				</FeatureAccess>
			) : null}
			{memory.categories?.length ? (
				<section>
					<h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
						{messages.MEMORY_DETAIL_CATEGORIES}
					</h3>
					<div className="flex flex-wrap gap-1.5">
						{memory.categories.map((category) => (
							<span
								key={category}
								className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[11px] text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200"
							>
								<span className={`size-1.5 rounded-full ${categoryDot(category)}`} />
								{category}
							</span>
						))}
					</div>
				</section>
			) : null}
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
				<MetaCard
					label={messages.MEMORY_DETAIL_KIND}
					value={kindLabel}
					dot={KIND_DOT[memory.kind]}
				/>
				<MetaCard label={messages.MEMORY_DETAIL_SESSION} value={memory.sessionId} />
				<MetaCard label={messages.MEMORY_DETAIL_AGENT} value={memory.agentId} />
				<MetaCard label={messages.MEMORY_DETAIL_APP} value={memory.appId} />
				<MetaCard
					label={messages.MEMORY_DETAIL_EXPIRATION}
					value={formatBrowserDateTime(memory.expirationDate, "")}
				/>
				<MetaCard label={messages.MEMORY_DETAIL_LIFECYCLE} value={memory.lifecycleState} />
				{typeof memory.synthesized === "boolean" ? (
					<MetaCard
						label={messages.MEMORY_DETAIL_SYNTHESIZED}
						value={memory.synthesized ? messages.MEMORY_DETAIL_YES : messages.MEMORY_DETAIL_NO}
					/>
				) : null}
				{typeof memory.score === "number" ? (
					<MetaCard
						label={messages.MEMORY_DETAIL_SCORE}
						value={String(memory.score)}
					/>
				) : null}
				{connectorName ? (
					<MetaCard label={messages.MEMORY_DETAIL_CONNECTOR} value={connectorName} />
				) : null}
			</div>
			{memory.metadata && Object.keys(memory.metadata).length > 0 ? (
				<section>
					<h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
						{messages.MEMORY_DETAIL_METADATA}
					</h3>
					<MemoryAttributeTable data={memory.metadata} />
				</section>
			) : null}
			{memory.structuredAttributes &&
			Object.keys(memory.structuredAttributes).length > 0 ? (
				<section>
					<h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
						{messages.MEMORY_DETAIL_STRUCTURED}
					</h3>
					<MemoryAttributeTable data={memory.structuredAttributes} />
				</section>
			) : null}
		</div>
	);
}

function MemoryFeedbackPanel({
	memoryId,
	connectorId,
	feedback,
	onFeedback,
}: {
	memoryId: string;
	connectorId?: string;
	feedback?: MemoryFeedback;
	onFeedback?: (feedback: MemoryFeedback) => void;
}) {
	const messages = getMessage();
	const [reason, setReason] = useState(feedback?.reason || "");
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		setReason(feedback?.reason || "");
	}, [memoryId, feedback?.reason]);

	function submit(rating: MemoryFeedbackRating | null) {
		if (saving) return;
		setSaving(true);
		const params = new URLSearchParams();
		if (connectorId) params.set("connectorId", connectorId);
		fetch(`/api/memory/${encodeURIComponent(memoryId)}/feedback?${params.toString()}`, {
			method: "POST",
			headers: getRequestHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({
				rating,
				reason: rating ? reason.trim() || null : null,
			}),
		})
			.then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					const message =
						typeof body === "string"
							? body
							: body?.err || body?.error || messages.MEMORY_DETAIL_FEEDBACK_SAVE_FAILED;
					throw new Error(message);
				}
				return body as { feedback?: MemoryFeedback; memory?: MemoryListItem };
			})
			.then((payload) => {
				const next = payload.memory?.feedback || payload.feedback || {};
				onFeedback?.(next);
				toast.success(
					rating ? messages.MEMORY_DETAIL_FEEDBACK_SAVED : messages.MEMORY_DETAIL_FEEDBACK_CLEARED
				);
			})
			.catch((caught: unknown) => {
				toast.error(
					caught instanceof Error
						? caught.message
						: messages.MEMORY_DETAIL_FEEDBACK_SAVE_FAILED
				);
			})
			.finally(() => setSaving(false));
	}

	const selected = feedback?.rating;
	const reasonDirty = reason.trim() !== (feedback?.reason || "");

	return (
		<section>
			<h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
				{messages.MEMORY_DETAIL_FEEDBACK}
			</h3>
			<div className="flex flex-wrap items-center gap-1.5">
				<FeedbackRatingButton
					active={selected === "positive"}
					disabled={saving}
					label={messages.MEMORY_DETAIL_FEEDBACK_POSITIVE}
					onClick={() => submit(selected === "positive" ? null : "positive")}
					icon={<ThumbsUp className="h-3.5 w-3.5" />}
					activeClass="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
				/>
				<FeedbackRatingButton
					active={selected === "negative"}
					disabled={saving}
					label={messages.MEMORY_DETAIL_FEEDBACK_NEGATIVE}
					onClick={() => submit(selected === "negative" ? null : "negative")}
					icon={<ThumbsDown className="h-3.5 w-3.5" />}
					activeClass="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
				/>
				<FeedbackRatingButton
					active={selected === "very_negative"}
					disabled={saving}
					label={messages.MEMORY_DETAIL_FEEDBACK_VERY_NEGATIVE}
					onClick={() => submit(selected === "very_negative" ? null : "very_negative")}
					icon={<Angry className="h-3.5 w-3.5" />}
					activeClass="border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
				/>
				{selected || feedback?.reason ? (
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-7 border-stone-200 bg-white text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300"
						disabled={saving}
						onClick={() => {
							setReason("");
							submit(null);
						}}
					>
						{messages.MEMORY_DETAIL_FEEDBACK_CLEAR}
					</Button>
				) : null}
			</div>
			<div className="mt-2 flex items-center gap-1.5">
				<Input
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					placeholder={messages.MEMORY_DETAIL_FEEDBACK_REASON_PLACEHOLDER}
					maxLength={1000}
					disabled={saving}
					aria-label={messages.MEMORY_DETAIL_FEEDBACK_REASON}
					className="h-8 min-w-0 flex-1 text-xs text-stone-900 placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
				/>
				<Button
					type="button"
					size="sm"
					className="h-8 shrink-0"
					disabled={saving || !selected || !reasonDirty}
					onClick={() => selected && submit(selected)}
				>
					{messages.MEMORY_DETAIL_FEEDBACK_SUBMIT}
				</Button>
			</div>
		</section>
	);
}

function FeedbackRatingButton({
	active,
	disabled,
	label,
	onClick,
	icon,
	activeClass,
}: {
	active: boolean;
	disabled: boolean;
	label: string;
	onClick: () => void;
	icon: ReactNode;
	activeClass: string;
}) {
	return (
		<Button
			type="button"
			size="sm"
			variant="outline"
			disabled={disabled}
			onClick={onClick}
			className={`h-7 gap-1.5 ${
				active
					? activeClass
					: "border-stone-200 bg-white text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300"
			}`}
		>
			{icon}
			{label}
		</Button>
	);
}

function MemoryInputTab({ messages: items }: { messages: MemoryMessage[] }) {
	const copy = getMessage();
	if (!items.length) {
		return (
			<p className="text-sm text-stone-500 dark:text-stone-400">
				{copy.MEMORY_DETAIL_INPUT_EMPTY}
			</p>
		);
	}
	return (
		<ul className="space-y-2">
			{items.map((item, index) => (
				<li
					key={`${item.role}-${index}`}
					className={`rounded-md border px-3 py-2 ${inputBubbleClass(item.role)}`}
				>
					<p className="text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
						{item.role}
					</p>
					<p className="mt-1 whitespace-pre-wrap text-sm text-stone-800 dark:text-stone-200">
						{item.content}
					</p>
				</li>
			))}
		</ul>
	);
}

function MemoryChangelogTab({ events }: { events: MemoryHistoryEvent[] }) {
	const messages = getMessage();
	if (!events.length) {
		return (
			<p className="text-sm text-stone-500 dark:text-stone-400">
				{messages.MEMORY_DETAIL_CHANGELOG_EMPTY}
			</p>
		);
	}
	return (
		<ol className="space-y-3">
			{events.map((event, index) => (
				<li
					key={event.id || `${event.event}-${index}`}
					className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800"
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-xs font-semibold text-stone-900 dark:text-stone-100">
							{eventLabel(event.event, messages)}
						</p>
						<p className="text-[11px] text-stone-500 dark:text-stone-400">
							{formatBrowserDateTime(event.createdAt, "")}
						</p>
					</div>
					{event.oldMemory ? (
						<p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
							<span className="font-medium">{messages.MEMORY_DETAIL_OLD_MEMORY}: </span>
							{event.oldMemory}
						</p>
					) : null}
					{event.newMemory ? (
						<p className="mt-1 text-sm text-stone-800 dark:text-stone-200">
							<span className="text-xs font-medium text-stone-500 dark:text-stone-400">
								{messages.MEMORY_DETAIL_NEW_MEMORY}:{" "}
							</span>
							{event.newMemory}
						</p>
					) : null}
				</li>
			))}
		</ol>
	);
}

function MemoryAttributeTable({ data }: { data: Record<string, unknown> }) {
	const formatted = formatDatePartsValue(data);
	if (formatted) {
		return (
			<p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
				{formatted}
			</p>
		);
	}
	const entries = objectEntries(data);
	if (!entries.length) return null;
	return (
		<div className="overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
			<AttributeRows entries={entries} />
		</div>
	);
}

function AttributeRows({ entries }: { entries: Array<[string, unknown]> }) {
	return (
		<div className="divide-y divide-stone-200 dark:divide-stone-800">
			{entries.map(([key, value], index) => (
				<div
					key={`${key}-${index}`}
					className={`grid min-w-0 grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[minmax(140px,32%)_minmax(0,1fr)] sm:items-start sm:gap-3 ${
						index % 2 === 0
							? "bg-white dark:bg-stone-950"
							: "bg-stone-50 dark:bg-stone-900/70"
					}`}
				>
					<div className="text-xs font-medium text-stone-500 dark:text-stone-400">
						{humanizeAttributeKey(key)}
					</div>
					<div className="min-w-0 break-words text-xs text-stone-900 dark:text-stone-100">
						<AttributeValue value={value} />
					</div>
				</div>
			))}
		</div>
	);
}

function AttributeValue({ value }: { value: unknown }) {
	const messages = getMessage();
	if (typeof value === "boolean") {
		return (
			<span
				className={`inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
					value
						? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
						: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
				}`}
			>
				{value ? messages.MEMORY_DETAIL_YES : messages.MEMORY_DETAIL_NO}
			</span>
		);
	}
	if (typeof value === "number") {
		return <span className="font-medium">{String(value)}</span>;
	}
	if (typeof value === "string") {
		const formatted = formatAttributeDate(value);
		return (
			<span className="whitespace-pre-wrap break-words">{formatted}</span>
		);
	}
	if (Array.isArray(value)) {
		if (!value.length) return null;
		if (value.every((item) => isPrimitive(item))) {
			return (
				<div className="flex flex-wrap gap-1">
					{value.map((item, index) => (
						<span
							key={`${String(item)}-${index}`}
							className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[11px] text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200"
						>
							{typeof item === "boolean"
								? item
									? messages.MEMORY_DETAIL_YES
									: messages.MEMORY_DETAIL_NO
								: formatAttributeDate(String(item))}
						</span>
					))}
				</div>
			);
		}
		return (
			<div className="space-y-2">
				{value.map((item, index) => (
					<div
						key={index}
						className="overflow-hidden rounded-md border border-stone-200 dark:border-stone-800"
					>
						<div className="border-b border-stone-200 bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
							{messages.MEMORY_DETAIL_ITEM(index + 1)}
						</div>
						{isPlainObject(item) ? (
							<AttributeRows entries={objectEntries(item)} />
						) : (
							<div className="px-2.5 py-1.5">
								<AttributeValue value={item} />
							</div>
						)}
					</div>
				))}
			</div>
		);
	}
	if (isPlainObject(value)) {
		const formatted = formatDatePartsValue(value);
		if (formatted) {
			return <span className="whitespace-pre-wrap break-words">{formatted}</span>;
		}
		const nested = objectEntries(value);
		if (!nested.length) return null;
		return (
			<div className="overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
				<AttributeRows entries={nested} />
			</div>
		);
	}
	return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}

function objectEntries(data: unknown): Array<[string, unknown]> {
	if (!isPlainObject(data)) return [];
	return Object.entries(data).filter(([, value]) => !isEmptyAttribute(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(value: unknown): boolean {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function isEmptyAttribute(value: unknown): boolean {
	return value === null || value === undefined || value === "";
}

function humanizeAttributeKey(key: string): string {
	const spaced = key.replace(/_/g, " ").replace(/\s+/g, " ").trim();
	if (!spaced) return key;
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatAttributeDate(value: string): string {
	if (!/^\d{4}-\d{2}-\d{2}(?:[T ]|$)/.test(value)) return value;
	return formatBrowserDateTime(value, value);
}

function inputBubbleClass(role: string): string {
	const key = role.trim().toLowerCase();
	if (key === "assistant" || key === "ai" || key === "model") {
		return "border-violet-200 bg-violet-50/70 dark:border-violet-900/70 dark:bg-violet-950/20";
	}
	if (key === "system") {
		return "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950";
	}
	return "border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900";
}

function HeaderMeta({ label, value }: { label: string; value?: string }) {
	if (!value) return null;
	return (
		<span>
			<span className="text-stone-400">{label}:</span> {value}
		</span>
	);
}

function MetaCard({
	label,
	value,
	dot,
}: {
	label: string;
	value?: string;
	dot?: string;
}) {
	if (!value) return null;
	return (
		<div className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5 dark:border-stone-800 dark:bg-stone-900">
			<p className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
				{dot ? <span className={`size-1.5 rounded-full ${dot}`} /> : null}
				{label}
			</p>
			<p className="mt-0.5 truncate text-xs font-semibold text-stone-900 dark:text-stone-100">
				{value}
			</p>
		</div>
	);
}

function ResizableDetailSheet({ children }: { children: ReactNode }) {
	const [maxWidth, setMaxWidth] = useState(1200);
	const [defaultWidth, setDefaultWidth] = useState(760);

	useEffect(() => {
		const updateBounds = () => {
			const viewportWidth = window.innerWidth;
			const nextMaxWidth = Math.max(420, viewportWidth - 32);
			setMaxWidth(nextMaxWidth);
			setDefaultWidth(Math.min(Math.max(viewportWidth * 0.68, 720), nextMaxWidth));
		};
		updateBounds();
		window.addEventListener("resize", updateBounds);
		return () => window.removeEventListener("resize", updateBounds);
	}, []);

	return (
		<ResizeablePanel
			defaultWidth={defaultWidth}
			minWidth={420}
			maxWidth={maxWidth}
			handlePosition="left"
			className="h-full max-w-[calc(100vw-1rem)] rounded-md bg-white shadow-2xl dark:bg-stone-950"
			handleClassName="opacity-100 border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900"
		>
			<div className="flex h-full min-h-0 flex-col overflow-hidden">{children}</div>
		</ResizeablePanel>
	);
}

function copyMemoryId(id: string, copiedMessage: string) {
	void navigator.clipboard.writeText(id).then(
		() => toast.success(copiedMessage),
		() => undefined
	);
}

function apiError(body: unknown, fallback: string): string {
	if (typeof body === "string" && body.trim()) return body;
	if (body && typeof body === "object") {
		const record = body as { err?: unknown; error?: unknown };
		if (typeof record.err === "string" && record.err.trim()) return record.err;
		if (typeof record.error === "string" && record.error.trim()) return record.error;
	}
	return fallback;
}

function truncateId(id: string): string {
	if (id.length <= 18) return id;
	return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function categoryDot(name: string): string {
	let hash = 0;
	for (let index = 0; index < name.length; index += 1) {
		hash = (hash * 31 + name.charCodeAt(index)) | 0;
	}
	return CATEGORY_DOTS[Math.abs(hash) % CATEGORY_DOTS.length];
}

function eventLabel(
	event: string,
	messages: ReturnType<typeof getMessage>
): string {
	const key = event.trim().toUpperCase();
	if (key === "ADD" || key === "ADDED") return messages.MEMORY_DETAIL_EVENT_ADDED;
	if (key === "UPDATE" || key === "UPDATED") return messages.MEMORY_DETAIL_EVENT_UPDATED;
	if (key === "DELETE" || key === "DELETED") return messages.MEMORY_DETAIL_EVENT_DELETED;
	return event;
}

function kindMessage(
	messages: ReturnType<typeof getMessage>,
	kind: MemoryKind
): string {
	if (kind === "temporal") return messages.MEMORY_TEMPORAL;
	if (kind === "profile") return messages.MEMORY_PROFILE;
	return messages.MEMORY_SUMMARY;
}
