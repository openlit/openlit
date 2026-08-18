"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { BrainCircuit, Cable, Plus, RefreshCw, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import FeatureAccess from "@/components/rbac/feature-access";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import {
	SourceFormDialog,
	type TypeDescriptor,
} from "@/components/(playground)/telemetry-source/data-sources-page";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import getMessage from "@/constants/messages";
import { CLIENT_EVENTS } from "@/constants/events";
import { getCurrentProject, getCurrentProjectEnvironment } from "@/selectors/project";
import { useRootStore } from "@/store";
import type {
	MemoryListItem,
	MemoryQueryResult,
} from "@/lib/platform/connectors/memory/read";
import { emptyMemoryStats } from "@/lib/platform/connectors/memory/graph";
import {
	emptyMemoryFilters,
	type MemoryFilterChoice,
	type MemoryFilterField,
	type MemoryFilterKey,
} from "@/lib/platform/connectors/memory/types";
import { connectorIconPath } from "@/lib/platform/connectors/icons";
import MemoryGraph from "./memory-graph";
import MemoryList from "./memory-list";
import MemoryDetailSheet from "./memory-detail-sheet";
import MemoryWriteDialog from "./memory-write-dialog";
import MemoryCopyDialog from "./memory-copy-dialog";
import MemoryFilterCombobox, {
	memoryFilterChoices,
} from "./memory-filter-combobox";
import AskOtterBar from "./ask-otter";

type ConnectorOption = {
	id: string;
	name: string;
	type: string;
	environment?: string;
	capabilities?: { add?: boolean } | null;
	filterFields?: MemoryFilterField[];
};

export default function MemoryPage() {
	const messages = getMessage();
	const posthog = usePostHog();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const project = useRootStore(getCurrentProject);
	const environment = useRootStore(getCurrentProjectEnvironment) || "production";
	const selectedId = searchParams.get("id");
	const [connectorId, setConnectorId] = useState(
		() => searchParams.get("connectorId") || ""
	);
	const [userId, setUserId] = useState("");
	const [sessionId, setSessionId] = useState("");
	const [agentId, setAgentId] = useState("");
	const [listSearch, setListSearch] = useState("");
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [result, setResult] = useState<MemoryQueryResult | null>(null);
	const [addOpen, setAddOpen] = useState(false);
	const [copyOpen, setCopyOpen] = useState(false);
	const [copyIds, setCopyIds] = useState<string[] | undefined>();
	const [addConnectorOpen, setAddConnectorOpen] = useState(false);
	const [memoryDescriptors, setMemoryDescriptors] = useState<TypeDescriptor[]>(
		[]
	);
	const [saving, setSaving] = useState(false);
	const autoSelecting = useRef(false);
	const loadSeq = useRef(0);
	const pendingCreated = useRef<MemoryListItem[]>([]);

	const replaceQuery = useCallback(
		(patch: { id?: string | null; connectorId?: string | null }) => {
			const params = new URLSearchParams(searchParams.toString());
			if (patch.id) params.set("id", patch.id);
			else if (patch.id === null) params.delete("id");
			if (patch.connectorId) params.set("connectorId", patch.connectorId);
			else if (patch.connectorId === null) params.delete("connectorId");
			const query = params.toString();
			router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
		},
		[pathname, router, searchParams]
	);

	const selectMemory = useCallback(
		(id: string | null) => {
			if (id) {
				replaceQuery({
					id,
					connectorId: connectorId || undefined,
				});
				return;
			}
			replaceQuery({ id: null });
		},
		[connectorId, replaceQuery]
	);

	const connectors = (result?.connectors || []) as ConnectorOption[];
	const copyTargets = connectors.filter(
		(connector) => connector.id !== connectorId && connector.capabilities?.add
	);
	const filters = result?.filters || emptyMemoryFilters();
	const filterFields = result?.filterFields || [];

	const loadMemories = useCallback((options?: { silent?: boolean }) => {
		if (!project?.id) {
			setLoading(false);
			return;
		}
		if (!options?.silent) setLoading(true);
		setLoadError(null);
		const seq = ++loadSeq.current;
		const params = new URLSearchParams();
		if (connectorId) params.set("connectorId", connectorId);
		if (userId.trim()) params.set("userId", userId.trim());
		if (sessionId.trim()) params.set("sessionId", sessionId.trim());
		if (agentId.trim()) params.set("agentId", agentId.trim());
		params.set("limit", "100");
		fetch(`/api/memory?${params.toString()}`)
			.then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					throw new Error(apiError(body, messages.MEMORY_LOAD_FAILED));
				}
				return body as MemoryQueryResult;
			})
			.then((payload) => {
				if (seq !== loadSeq.current) return;
				const pending = pendingCreated.current.filter(
					(memory) => !payload.memories.some((item) => item.id === memory.id)
				);
				pendingCreated.current = pending;
				setResult(
					pending.length
						? {
								...payload,
								memories: prependMemories(pending, payload.memories),
							}
						: payload
				);
				const nextId = payload.connector?.id ? String(payload.connector.id) : "";
				if (nextId && nextId !== connectorId) setConnectorId(nextId);
				const nextFields = payload.filterFields || [];
				const nextUsers = payload.filters?.users || [];
				const nextSessions = payload.filters?.sessions || [];
				if (!fieldEnabled(nextFields, "userId") && userId) setUserId("");
				if (!fieldEnabled(nextFields, "sessionId") && sessionId) setSessionId("");
				if (!fieldEnabled(nextFields, "agentId") && agentId) setAgentId("");
				const userField = nextFields.find((field) => field.key === "userId");
				const sessionField = nextFields.find((field) => field.key === "sessionId");
				if (userField?.required && !userId && nextUsers.length === 1) {
					autoSelecting.current = true;
					setUserId(nextUsers[0].id);
				} else if (
					sessionField?.required &&
					!sessionId &&
					(payload.hint === "session_required" || payload.hint === "filter_required")
				) {
					const onlySessions = nextSessions.filter(
						(session) => !userId || !session.userId || session.userId === userId
					);
					if (onlySessions.length === 1) {
						autoSelecting.current = true;
						setSessionId(onlySessions[0].id);
					}
				}
			})
			.catch((caught: unknown) => {
				if (seq !== loadSeq.current) return;
				const message =
					caught instanceof Error ? caught.message : messages.MEMORY_LOAD_FAILED;
				setLoadError(
					/invalid.*api key|authentication_error|authentication failed/i.test(
						message
					)
						? messages.MEMORY_AUTH_FAILED_HINT
						: messages.MEMORY_UNAVAILABLE_DESCRIPTION
				);
			})
			.finally(() => {
				if (seq !== loadSeq.current) return;
				autoSelecting.current = false;
				setLoading(false);
			});
	}, [
		agentId,
		connectorId,
		messages.MEMORY_AUTH_FAILED_HINT,
		messages.MEMORY_LOAD_FAILED,
		messages.MEMORY_UNAVAILABLE_DESCRIPTION,
		project?.id,
		sessionId,
		userId,
	]);

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.MEMORY_PAGE_VISITED);
	}, [posthog]);

	useEffect(() => {
		loadMemories();
	}, [loadMemories]);

	useEffect(() => {
		if (!addConnectorOpen) return;
		fetch("/api/connectors/types")
			.then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) return;
				setMemoryDescriptors(
					((body?.types || []) as TypeDescriptor[]).filter(
						(descriptor) => descriptor.category === "memory"
					)
				);
			})
			.catch(() => {
				setMemoryDescriptors([]);
			});
	}, [addConnectorOpen]);

	const stats = result?.stats || emptyMemoryStats();
	const statItems = useMemo(
		() => [
			{ label: messages.MEMORY_TOTAL, value: stats.total },
			{ label: messages.MEMORY_CONNECTIONS, value: stats.connections },
			{ label: messages.MEMORY_TEMPORAL, value: stats.temporal, dot: "bg-teal-500" },
			{ label: messages.MEMORY_PROFILE, value: stats.profile, dot: "bg-orange-500" },
			{ label: messages.MEMORY_SUMMARY, value: stats.summary, dot: "bg-lime-500" },
		],
		[messages, stats]
	);

	const needsScope =
		result?.hint === "filter_required" || result?.hint === "session_required";
	const connectorError =
		result?.hint === "auth_failed" || result?.hint === "unavailable";
	const hasFilterOptions =
		filterFields.some((field) => field.allowCustom !== false) ||
		filters.users.length + filters.sessions.length + filters.agents.length > 0;
	const showBrowse =
		!loadError && !needsScope && !connectorError && connectors.length > 0;

	function handleConnectorChange(nextId: string) {
		setConnectorId(nextId);
		setUserId("");
		setSessionId("");
		setAgentId("");
		setResult((prev) =>
			prev
				? {
						...prev,
						memories: [],
						filters: emptyMemoryFilters(),
						filterFields: [],
						graph: { nodes: [], edges: [] },
						hint: undefined,
						connector:
							connectors.find((connector) => connector.id === nextId) ||
							prev.connector,
					}
				: prev
		);
		replaceQuery({ id: null, connectorId: nextId || null });
	}

	function handleFilterChange(key: MemoryFilterKey, nextId: string) {
		if (key === "userId") {
			handleUserChange(nextId);
			return;
		}
		if (key === "sessionId") {
			setSessionId(nextId);
			return;
		}
		setAgentId(nextId);
	}

	function filterValue(key: MemoryFilterKey): string {
		if (key === "userId") return userId;
		if (key === "sessionId") return sessionId;
		return agentId;
	}

	function filterOptions(field: MemoryFilterField): MemoryFilterChoice[] {
		return memoryFilterChoices(field, filters, userId);
	}

	function handleUserChange(nextId: string) {
		setUserId(nextId);
		if (
			sessionId &&
			!filters.sessions.some(
				(session) =>
					session.id === sessionId && (!session.userId || session.userId === nextId)
			)
		) {
			setSessionId("");
		}
	}

	function handleAdd(input: {
		content: string;
		userId?: string;
		sessionId?: string;
		agentId?: string;
	}) {
		if (saving) return;
		setSaving(true);
		fetch("/api/memory", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				connectorId: connectorId || undefined,
				content: input.content,
				userId: input.userId,
				sessionId: input.sessionId,
				agentId: input.agentId,
			}),
		})
			.then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					throw new Error(apiError(body, messages.MEMORY_ADD_FAILED));
				}
				return body as { memories?: MemoryListItem[] };
			})
			.then((payload) => {
				toast.success(messages.MEMORY_ADD_SAVED);
				setAddOpen(false);
				const nextUser = input.userId?.trim() || "";
				const nextSession = input.sessionId?.trim() || "";
				const nextAgent = input.agentId?.trim() || "";
				const filtersChanged =
					(nextUser && nextUser !== userId) ||
					(nextSession && nextSession !== sessionId) ||
					(nextAgent && nextAgent !== agentId);
				if (nextUser) setUserId(nextUser);
				if (nextSession) setSessionId(nextSession);
				if (nextAgent) setAgentId(nextAgent);
				const created = payload.memories || [];
				if (created.length) {
					pendingCreated.current = prependMemories(
						created,
						pendingCreated.current
					);
					setResult((prev) =>
						prev
							? {
									...prev,
									memories: prependMemories(created, prev.memories),
									stats: {
										...prev.stats,
										total:
											prev.stats.total +
											created.filter(
												(memory) =>
													!prev.memories.some((item) => item.id === memory.id)
											).length,
									},
								}
							: prev
					);
				}
				const createdId = created[0]?.id;
				if (createdId) selectMemory(createdId);
				if (!filtersChanged) loadMemories({ silent: true });
			})
			.catch((caught: unknown) => {
				toast.error(
					caught instanceof Error ? caught.message : messages.MEMORY_ADD_FAILED
				);
			})
			.finally(() => setSaving(false));
	}

	function openCopy(ids?: string[]) {
		setCopyIds(ids);
		setCopyOpen(true);
	}

	function openSourceMemory(sourceConnectorId: string, sourceMemoryId: string) {
		setConnectorId(sourceConnectorId);
		replaceQuery({ id: sourceMemoryId, connectorId: sourceConnectorId });
	}

	function handleCopy(input: {
		targetConnectorId: string;
		userId?: string;
		sessionId?: string;
		agentId?: string;
	}) {
		if (saving) return;
		setSaving(true);
		fetch("/api/memory/copy", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				sourceConnectorId: connectorId || undefined,
				targetConnectorId: input.targetConnectorId,
				memoryIds: copyIds,
				userId: userId || undefined,
				sessionId: sessionId || undefined,
				agentId: agentId || undefined,
				targetUserId: input.userId,
				targetSessionId: input.sessionId,
				targetAgentId: input.agentId,
			}),
		})
			.then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					throw new Error(apiError(body, messages.MEMORY_COPY_FAILED));
				}
				return body as {
					copied?: number;
					failed?: { id: string }[];
					target?: { name?: string };
				};
			})
			.then((payload) => {
				const copied = payload.copied || 0;
				const failed = payload.failed?.length || 0;
				const targetName = payload.target?.name || messages.MEMORY_COPY_TARGET;
				if (failed && copied) {
					toast.success(messages.MEMORY_COPY_PARTIAL(copied, failed));
				} else {
					toast.success(messages.MEMORY_COPY_SAVED(copied, targetName));
				}
				setCopyOpen(false);
				setConnectorId(input.targetConnectorId);
				replaceQuery({ id: null, connectorId: input.targetConnectorId });
			})
			.catch((caught: unknown) => {
				toast.error(
					caught instanceof Error ? caught.message : messages.MEMORY_COPY_FAILED
				);
			})
			.finally(() => setSaving(false));
	}

	return (
		<div className="flex h-full min-h-0 w-full flex-col overflow-hidden text-stone-700 dark:text-stone-300">
			<FeaturePageHeader
				eyebrow={messages.SIDEBAR_DEVELOP}
				title={messages.FEATURE_MEMORY}
				icon={<BrainCircuit className="h-4 w-4" />}
				tone="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/70 dark:bg-violet-950/40 dark:text-violet-300"
				actions={
					<div className="flex items-center gap-1.5">
						<FeatureAccess access="memory.create" hideWhenDenied>
							{result?.capabilities?.add ? (
								<Button
									size="sm"
									className="h-8 gap-1.5"
									onClick={() => setAddOpen(true)}
									disabled={loading || !project?.id || !connectorId}
								>
									<Plus className="size-3.5" />
									{messages.MEMORY_ADD}
								</Button>
							) : null}
							{copyTargets.length > 0 ? (
								<Button
									size="sm"
									variant="outline"
									className="h-8 gap-1.5"
									onClick={() => {
										setCopyIds(undefined);
										setCopyOpen(true);
									}}
									disabled={loading || !project?.id || !connectorId || !result?.memories.length}
								>
									<ArrowRightLeft className="size-3.5" />
									{messages.MEMORY_COPY}
								</Button>
							) : null}
						</FeatureAccess>
						<FeatureAccess access="connectors.create" hideWhenDenied>
							<Button
								size="sm"
								variant="outline"
								className="h-8 gap-1.5"
								onClick={() => setAddConnectorOpen(true)}
								disabled={!project?.id}
							>
								<Cable className="size-3.5" />
								{messages.ADD_CONNECTOR}
							</Button>
						</FeatureAccess>
						<Button
							size="sm"
							variant="outline"
							className="h-8 gap-1.5"
							onClick={() => loadMemories()}
							disabled={loading || !project?.id}
						>
							<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
							{messages.MEMORY_REFRESH}
						</Button>
					</div>
				}
			/>

			<FeatureAccess access="memory.read" requireProject>
				<div className="flex min-h-0 flex-1 flex-col">
					<div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-2 dark:border-stone-800">
						<FilterSelect
							label={messages.MEMORY_CONNECTOR_LABEL}
							value={connectorId}
							options={connectors.map((connector) => ({
								id: connector.id,
								label: connector.environment
									? `${connector.name} · ${connector.environment}`
									: connector.name,
								icon: connectorIconPath(connector.type),
							}))}
							onChange={handleConnectorChange}
							disabled={loading || connectors.length === 0}
							widthClass="w-[260px]"
						/>
						{filterFields.map((field) => (
							<MemoryFilterCombobox
								key={`${connectorId}-${field.key}`}
								label={field.label}
								value={filterValue(field.key)}
								options={filterOptions(field)}
								onChange={(next) => handleFilterChange(field.key, next)}
								allowCustom={field.allowCustom !== false}
								disabled={loading}
								required={field.required}
								widthClass="w-[240px]"
							/>
						))}
					</div>

					{!loading && connectors.length === 0 ? (
						<EmptyPanel
							title={messages.FEATURE_MEMORY}
							description={messages.MEMORY_EMPTY_CONNECTORS}
							action={
								<FeatureAccess access="connectors.create" hideWhenDenied>
									<Button size="sm" onClick={() => setAddConnectorOpen(true)}>
										{messages.MEMORY_EMPTY_CONNECTORS_ACTION}
									</Button>
								</FeatureAccess>
							}
						/>
					) : loadError || connectorError ? (
						<EmptyPanel
							title={messages.MEMORY_UNAVAILABLE_TITLE}
							description={
								result?.hint === "auth_failed"
									? messages.MEMORY_AUTH_FAILED_HINT
									: loadError || messages.MEMORY_UNAVAILABLE_DESCRIPTION
							}
							action={
								<Button size="sm" variant="outline" onClick={() => loadMemories()}>
									{messages.MEMORY_RETRY}
								</Button>
							}
						/>
					) : needsScope && !loading ? (
						<EmptyPanel
							title={messages.FEATURE_MEMORY}
							description={
								!hasFilterOptions
									? messages.MEMORY_FILTER_EMPTY
									: result?.hint === "session_required"
										? messages.MEMORY_SESSION_REQUIRED_HINT
										: messages.MEMORY_FILTER_REQUIRED_HINT
							}
						/>
					) : showBrowse || loading ? (
						<>
							<div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-5">
								{loading
									? Array.from({ length: 5 }).map((_, index) => (
											<Skeleton key={index} className="h-[58px] rounded-md" />
										))
									: statItems.map((item) => (
											<StatCard key={item.label} {...item} />
										))}
							</div>
							<Tabs
								defaultValue="graph"
								className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-3"
							>
								<TabsList className="h-9 w-max justify-start rounded-md bg-stone-100 p-1 dark:bg-stone-900">
									<TabsTrigger value="graph" className="shrink-0 px-3 py-1 text-xs">
										{messages.MEMORY_GRAPH_TITLE}
									</TabsTrigger>
									<TabsTrigger value="list" className="shrink-0 px-3 py-1 text-xs">
										{messages.MEMORY_LIST_TITLE}
									</TabsTrigger>
								</TabsList>
								<TabsContent
									value="graph"
									forceMount
									className="mt-2 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden data-[state=active]:flex data-[state=active]:flex-col"
								>
									{loading ? (
										<Skeleton className="h-full min-h-[280px] rounded-md" />
									) : (
										<MemoryGraph
											graph={result?.graph || { nodes: [], edges: [] }}
											selectedId={selectedId}
											onSelect={selectMemory}
										/>
									)}
								</TabsContent>
								<TabsContent
									value="list"
									forceMount
									className="mt-2 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden data-[state=active]:flex data-[state=active]:flex-col"
								>
									{loading ? (
										<Skeleton className="h-full min-h-[280px] rounded-md" />
									) : (
										<MemoryList
											memories={result?.memories || []}
											search={listSearch}
											onSearchChange={setListSearch}
											selectedId={selectedId}
											onSelect={selectMemory}
										/>
									)}
								</TabsContent>
							</Tabs>
						</>
					) : null}

					<AskOtterBar
						disabled={connectors.length === 0}
						scope={{ connectorId, userId, sessionId, agentId }}
					/>
					<MemoryDetailSheet
						open={!!selectedId}
						memoryId={selectedId}
						memoryIds={(result?.memories || []).map((memory) => memory.id)}
						connectorId={connectorId}
						capabilities={result?.capabilities}
						preview={
							result?.memories.find((memory) => memory.id === selectedId) || null
						}
						onSelect={selectMemory}
						onClose={() => selectMemory(null)}
						onChanged={() => loadMemories()}
						onCopy={copyTargets.length ? (id) => openCopy([id]) : undefined}
						onOpenSource={openSourceMemory}
					/>
					<MemoryWriteDialog
						open={addOpen}
						mode="add"
						scope={{ userId, sessionId, agentId }}
						filterFields={filterFields}
						filters={filters}
						saving={saving}
						onOpenChange={setAddOpen}
						onSubmit={handleAdd}
					/>
					<MemoryCopyDialog
						open={copyOpen}
						count={copyIds?.length || result?.memories.length || 0}
						targets={copyTargets}
						filters={filters}
						saving={saving}
						onOpenChange={setCopyOpen}
						onSubmit={handleCopy}
					/>
					{addConnectorOpen ? (
						<SourceFormDialog
							source={null}
							descriptors={memoryDescriptors}
							initialType=""
							initialEnvironment={environment}
							showRouting={false}
							onClose={() => setAddConnectorOpen(false)}
							onSaved={() => {
								setAddConnectorOpen(false);
								loadMemories({ silent: true });
							}}
						/>
					) : null}
				</div>
			</FeatureAccess>
		</div>
	);
}

function prependMemories(
	incoming: MemoryListItem[],
	existing: MemoryListItem[]
): MemoryListItem[] {
	if (!incoming.length) return existing;
	const seen = new Set(incoming.map((memory) => memory.id));
	return [...incoming, ...existing.filter((memory) => !seen.has(memory.id))];
}

function fieldEnabled(
	fields: MemoryFilterField[],
	key: MemoryFilterKey
): boolean {
	return fields.some((field) => field.key === key);
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

function FilterSelect({
	label,
	value,
	options,
	onChange,
	disabled,
	widthClass = "w-[180px]",
}: {
	label: string;
	value: string;
	options: Array<MemoryFilterChoice & { icon?: string }>;
	onChange: (value: string) => void;
	disabled?: boolean;
	widthClass?: string;
}) {
	const selected = options.find((option) => option.id === value);
	return (
		<Select value={selected?.id} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger className={`h-8 ${widthClass}`} aria-label={label}>
				<SelectValue placeholder={label}>
					{selected ? (
						<span className="flex min-w-0 items-center gap-2">
							{selected.icon ? (
								<Image
									src={selected.icon}
									alt=""
									width={16}
									height={16}
									className="h-4 w-4 shrink-0 object-contain"
								/>
							) : null}
							<span className="truncate">{selected.label}</span>
						</span>
					) : undefined}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.id} value={option.id}>
						<span className="flex min-w-0 items-center gap-2">
							{option.icon ? (
								<Image
									src={option.icon}
									alt=""
									width={16}
									height={16}
									className="h-4 w-4 shrink-0 object-contain"
								/>
							) : null}
							<span className="truncate">{option.label}</span>
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function EmptyPanel({
	title,
	description,
	action,
}: {
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<div className="m-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-200 bg-white px-6 py-12 text-center dark:border-stone-800 dark:bg-stone-950">
			<BrainCircuit className="h-8 w-8 text-stone-400 dark:text-stone-500" />
			<p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{title}</p>
			<p className="max-w-md text-xs text-stone-500 dark:text-stone-400">{description}</p>
			{action ? <div className="mt-2">{action}</div> : null}
		</div>
	);
}

function StatCard({
	label,
	value,
	dot,
}: {
	label: string;
	value: number;
	dot?: string;
}) {
	return (
		<div className="rounded-md border border-stone-200 bg-white px-3 py-2 dark:border-stone-800 dark:bg-stone-950">
			<p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
				{dot ? <span className={`size-1.5 rounded-full ${dot}`} /> : null}
				{label}
			</p>
			<p className="mt-1 text-lg font-semibold tabular-nums text-stone-950 dark:text-stone-50">
				{value}
			</p>
		</div>
	);
}
