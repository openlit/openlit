"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { BrainCircuit, RefreshCw } from "lucide-react";
import FeatureAccess from "@/components/rbac/feature-access";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import getMessage from "@/constants/messages";
import { CLIENT_EVENTS } from "@/constants/events";
import { getCurrentProject } from "@/selectors/project";
import { useRootStore } from "@/store";
import type { MemoryQueryResult } from "@/lib/platform/connectors/memory/read";
import { emptyMemoryStats } from "@/lib/platform/connectors/memory/graph";
import {
	emptyMemoryFilters,
	type MemoryFilterChoice,
} from "@/lib/platform/connectors/memory/types";
import MemoryGraph from "./memory-graph";
import MemoryList from "./memory-list";
import MemoryDetailSheet from "./memory-detail-sheet";
import AskOtterBar from "./ask-otter";

type ConnectorOption = {
	id: string;
	name: string;
	type: string;
	environment?: string;
};

export default function MemoryPage() {
	const messages = getMessage();
	const posthog = usePostHog();
	const project = useRootStore(getCurrentProject);
	const [connectorId, setConnectorId] = useState("");
	const [userId, setUserId] = useState("");
	const [sessionId, setSessionId] = useState("");
	const [agentId, setAgentId] = useState("");
	const [listSearch, setListSearch] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [result, setResult] = useState<MemoryQueryResult | null>(null);
	const autoSelecting = useRef(false);

	const connectors = (result?.connectors || []) as ConnectorOption[];
	const filters = result?.filters || emptyMemoryFilters();
	const sessionsForUser = useMemo(
		() =>
			filters.sessions.filter(
				(session) => !userId || !session.userId || session.userId === userId
			),
		[filters.sessions, userId]
	);

	const loadMemories = useCallback(() => {
		if (!project?.id) {
			setLoading(false);
			return;
		}
		setLoading(true);
		setLoadError(null);
		const params = new URLSearchParams();
		if (connectorId) params.set("connectorId", connectorId);
		if (userId.trim()) params.set("userId", userId.trim());
		if (sessionId.trim()) params.set("sessionId", sessionId.trim());
		if (agentId.trim()) params.set("agentId", agentId.trim());
		fetch(`/api/memory?${params.toString()}`)
			.then(async (response) => {
				const body = await response.json().catch(() => null);
				if (!response.ok) {
					throw new Error(messages.MEMORY_LOAD_FAILED);
				}
				return body as MemoryQueryResult;
			})
			.then((payload) => {
				setResult(payload);
				const nextId = payload.connector?.id ? String(payload.connector.id) : "";
				if (nextId && nextId !== connectorId) setConnectorId(nextId);
				setSelectedId((current) =>
					payload.memories.some((memory) => memory.id === current)
						? current
						: payload.memories[0]?.id || null
				);
				const nextUsers = payload.filters?.users || [];
				const nextSessions = payload.filters?.sessions || [];
				if (!userId && nextUsers.length === 1) {
					autoSelecting.current = true;
					setUserId(nextUsers[0].id);
				} else if (payload.hint === "session_required" && !sessionId) {
					const onlySessions = nextSessions.filter(
						(session) => !userId || !session.userId || session.userId === userId
					);
					if (onlySessions.length === 1) {
						autoSelecting.current = true;
						setSessionId(onlySessions[0].id);
					}
				}
			})
			.catch(() => {
				setLoadError(messages.MEMORY_LOAD_FAILED);
			})
			.finally(() => {
				if (autoSelecting.current) {
					autoSelecting.current = false;
					return;
				}
				setLoading(false);
			});
	}, [
		agentId,
		connectorId,
		messages.MEMORY_LOAD_FAILED,
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
	const hasFilterOptions =
		filters.users.length + filters.sessions.length + filters.agents.length > 0;
	const showBrowse = !loadError && !needsScope && connectors.length > 0;

	function handleConnectorChange(nextId: string) {
		setConnectorId(nextId);
		setUserId("");
		setSessionId("");
		setAgentId("");
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

	return (
		<div className="flex h-full min-h-0 w-full flex-col overflow-hidden text-stone-700 dark:text-stone-300">
			<FeaturePageHeader
				eyebrow={messages.SIDEBAR_DEVELOP}
				title={messages.FEATURE_MEMORY}
				description={messages.MEMORY_PAGE_DESCRIPTION}
				icon={<BrainCircuit className="h-4 w-4" />}
				tone="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/70 dark:bg-violet-950/40 dark:text-violet-300"
				actions={
					<Button
						size="sm"
						variant="outline"
						className="h-8 gap-1.5"
						onClick={loadMemories}
						disabled={loading || !project?.id}
					>
						<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
						{messages.MEMORY_REFRESH}
					</Button>
				}
			/>

			<FeatureAccess access="connectors.read" requireProject>
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
							}))}
							onChange={handleConnectorChange}
							disabled={loading || connectors.length === 0}
							widthClass="w-[220px]"
						/>
						<FilterSelect
							label={messages.MEMORY_USER_FILTER}
							value={userId}
							options={filters.users}
							onChange={handleUserChange}
							disabled={loading || filters.users.length === 0}
						/>
						<FilterSelect
							label={messages.MEMORY_SESSION_FILTER}
							value={sessionId}
							options={sessionsForUser}
							onChange={setSessionId}
							disabled={loading || sessionsForUser.length === 0}
						/>
						{filters.agents.length > 0 ? (
							<FilterSelect
								label={messages.MEMORY_AGENT_FILTER}
								value={agentId}
								options={filters.agents}
								onChange={setAgentId}
								disabled={loading}
							/>
						) : null}
					</div>

					{!loading && connectors.length === 0 ? (
						<EmptyPanel
							title={messages.FEATURE_MEMORY}
							description={messages.MEMORY_EMPTY_CONNECTORS}
							action={
								<Button asChild size="sm">
									<Link href="/connectors">{messages.MEMORY_EMPTY_CONNECTORS_ACTION}</Link>
								</Button>
							}
						/>
					) : loadError ? (
						<EmptyPanel
							title={messages.MEMORY_UNAVAILABLE_TITLE}
							description={messages.MEMORY_UNAVAILABLE_DESCRIPTION}
							action={
								<Button size="sm" variant="outline" onClick={loadMemories}>
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
							<div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden px-4 pb-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
								<div className="flex min-h-0 flex-col">
									<h2 className="mb-2 text-sm font-semibold text-stone-950 dark:text-stone-50">
										{messages.MEMORY_GRAPH_TITLE}
									</h2>
									<div className="min-h-0 flex-1">
										{loading ? (
											<Skeleton className="h-full min-h-[280px] rounded-md" />
										) : (
											<MemoryGraph
												graph={result?.graph || { nodes: [], edges: [] }}
												selectedId={selectedId}
												onSelect={setSelectedId}
											/>
										)}
									</div>
								</div>
								<div className="min-h-0">
									{loading ? (
										<Skeleton className="h-full min-h-[280px] rounded-md" />
									) : (
										<MemoryList
											memories={result?.memories || []}
											search={listSearch}
											onSearchChange={setListSearch}
											selectedId={selectedId}
											onSelect={setSelectedId}
										/>
									)}
								</div>
							</div>
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
						preview={
							result?.memories.find((memory) => memory.id === selectedId) || null
						}
						onSelect={setSelectedId}
						onClose={() => setSelectedId(null)}
					/>
				</div>
			</FeatureAccess>
		</div>
	);
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
	options: MemoryFilterChoice[];
	onChange: (value: string) => void;
	disabled?: boolean;
	widthClass?: string;
}) {
	const selected = options.some((option) => option.id === value) ? value : undefined;
	return (
		<Select value={selected} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger className={`h-8 ${widthClass}`} aria-label={label}>
				<SelectValue placeholder={label} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.id} value={option.id}>
						{option.label}
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
