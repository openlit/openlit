"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Copy, User, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import JSONViewer from "@/components/common/json-viewer";
import getMessage from "@/constants/messages";
import { formatBrowserDateTime } from "@/utils/date";
import type { MemoryDetailResult, MemoryListItem } from "@/lib/platform/connectors/memory/read";
import type { MemoryKind } from "@/lib/platform/connectors/memory/graph";
import type { MemoryHistoryEvent, MemoryMessage } from "@/lib/platform/connectors/memory/types";

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
	preview?: MemoryListItem | null;
	onSelect?: (id: string) => void;
	onClose: () => void;
};

export default function MemoryDetailSheet({
	open,
	memoryId,
	memoryIds = [],
	connectorId,
	preview,
	onSelect,
	onClose,
}: MemoryDetailSheetProps) {
	const messages = getMessage();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hint, setHint] = useState<MemoryDetailResult["hint"]>();
	const [detail, setDetail] = useState<MemoryListItem | null>(preview || null);
	const [connectorName, setConnectorName] = useState<string>("");

	useEffect(() => {
		if (!open || !memoryId) {
			setError(null);
			setHint(undefined);
			setDetail(null);
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
		})
			.then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					const message =
						typeof body === "string"
							? body
							: body?.err || body?.error || messages.MEMORY_DETAIL_LOAD_FAILED;
					throw new Error(message);
				}
				return body as MemoryDetailResult;
			})
			.then((payload) => {
				setHint(payload.hint);
				setConnectorName(payload.connector?.name ? String(payload.connector.name) : "");
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
	}, [connectorId, memoryId, messages.MEMORY_DETAIL_LOAD_FAILED, open, preview]);

	const memory = detail || preview;
	const title = memory?.content?.trim() || messages.MEMORY_DETAIL_TITLE;
	const index = memoryId ? memoryIds.indexOf(memoryId) : -1;
	const prevId = index > 0 ? memoryIds[index - 1] : undefined;
	const nextId =
		index >= 0 && index < memoryIds.length - 1 ? memoryIds[index + 1] : undefined;
	const inputCount = memory?.input?.length || 0;
	const changelogCount = memory?.history?.length || 0;

	return (
		<Sheet modal={false} open={open} onOpenChange={(next) => !next && onClose()}>
			<SheetContent
				side="right"
				className={DETAIL_SHEET_CONTENT_CLASS}
				displayOverlay={false}
				displayClose={false}
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
							</div>
							<div className="flex shrink-0 items-center gap-1">
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
										<TabsTrigger value="input" className="shrink-0 px-3 py-1 text-xs">
											{messages.MEMORY_DETAIL_TAB_INPUT}
											{inputCount ? ` (${inputCount})` : ""}
										</TabsTrigger>
										<TabsTrigger value="changelog" className="shrink-0 px-3 py-1 text-xs">
											{messages.MEMORY_DETAIL_TAB_CHANGELOG}
											{changelogCount ? ` (${changelogCount})` : ""}
										</TabsTrigger>
									</TabsList>
									<TabsContent value="details" className="mt-3">
										<MemoryDetailsTab
											memory={memory}
											connectorName={connectorName}
										/>
									</TabsContent>
									<TabsContent value="input" className="mt-3">
										<MemoryInputTab messages={memory.input || []} />
									</TabsContent>
									<TabsContent value="changelog" className="mt-3">
										<MemoryChangelogTab events={memory.history || []} />
									</TabsContent>
								</Tabs>
							) : null}
						</div>
					</div>
				</ResizableDetailSheet>
			</SheetContent>
		</Sheet>
	);
}

function MemoryDetailsTab({
	memory,
	connectorName,
}: {
	memory: MemoryListItem;
	connectorName?: string;
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
					<div className="rounded-md border border-stone-200 p-2 dark:border-stone-800">
						<JSONViewer value={memory.metadata} />
					</div>
				</section>
			) : null}
			{memory.structuredAttributes &&
			Object.keys(memory.structuredAttributes).length > 0 ? (
				<section>
					<h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
						{messages.MEMORY_DETAIL_STRUCTURED}
					</h3>
					<div className="rounded-md border border-stone-200 p-2 dark:border-stone-800">
						<JSONViewer value={memory.structuredAttributes} />
					</div>
				</section>
			) : null}
		</div>
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
					className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-900"
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
