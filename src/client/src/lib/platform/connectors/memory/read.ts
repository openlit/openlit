/**
 * Project-scoped memory reads for the Memory page and Otter tools.
 */

import {
	getMemoryRuntime,
	listMemoryConnectors,
	memoryConnectorId,
	readMemoryPortLinks,
	readRememberedMemoryFilters,
	rememberMemoryFilters,
	emptyRememberedMemoryFilters,
	type RememberedMemoryFilters,
} from "./crud";
import {
	buildMemoryGraph,
	classifyMemoryKind,
	emptyMemoryStats,
	summarizeMemoryStats,
	type MemoryGraphModel,
	type MemoryKind,
	type MemoryStats,
} from "./graph";
import {
	emptyMemoryFilters,
	UnsupportedMemoryCapabilityError,
	type MemoryAdapter,
	type MemoryCapabilities,
	type MemoryFeedback,
	type MemoryFeedbackInput,
	type MemoryFeedbackRating,
	type MemoryFilterChoice,
	type MemoryFilterField,
	type MemoryFilterOptions,
	type MemoryQueryHint,
	type MemoryRecord,
	isMemoryFeedbackRating,
} from "./types";
import { getMemoryTypeDescriptor } from "./registry";
import { attachMemoryPorts } from "./port-link";
import {
	DATA_SOURCE_SECRET_DECRYPT_FAILED,
	DATA_SOURCE_SECRET_NOT_FOUND,
	DATA_SOURCE_SECRET_UNAVAILABLE,
	MEMORY_CONNECTOR_FILTER_REQUIRED,
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_CONNECTOR_QUERY_REQUIRED,
	MEMORY_CONNECTOR_SESSION_REQUIRED,
	MEMORY_DETAIL_FEEDBACK_UNSUPPORTED,
	MEMORY_DETAIL_NOT_FOUND,
	MEMORY_FEEDBACK_INVALID,
	MEMORY_FEEDBACK_REASON_TOO_LONG,
} from "@/constants/messages/en";
import getMessage from "@/constants/messages";
import { SourceResponseError } from "../datasource/http/safe-fetch";

export interface MemoryQueryInput {
	connectorId?: string;
	userId?: string;
	agentId?: string;
	sessionId?: string;
	query?: string;
	limit?: number;
}

export interface MemoryListItem extends MemoryRecord {
	kind: MemoryKind;
}

export type MemoryConnectorOption = Awaited<
	ReturnType<typeof listMemoryConnectors>
>[number] & {
	capabilities?: MemoryCapabilities | null;
	filterFields?: MemoryFilterField[];
};

export interface MemoryQueryResult {
	connectors: MemoryConnectorOption[];
	connector: MemoryConnectorOption | null;
	capabilities: MemoryCapabilities | null;
	memories: MemoryListItem[];
	stats: MemoryStats;
	graph: MemoryGraphModel;
	filters: MemoryFilterOptions;
	filterFields: MemoryFilterField[];
	hint?: MemoryQueryHint;
}

export interface MemoryDetailResult {
	connector: MemoryQueryResult["connector"];
	capabilities: MemoryCapabilities | null;
	memory: MemoryListItem | null;
	hint?: "get_unsupported";
}

export interface MemoryFeedbackResult {
	connector: MemoryQueryResult["connector"];
	capabilities: MemoryCapabilities | null;
	feedback: MemoryFeedback;
	memory: MemoryListItem | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const FEEDBACK_REASON_MAX = 1000;

function trim(value?: string): string | undefined {
	const next = String(value || "").trim();
	return next || undefined;
}

function clampLimit(value?: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

function fallbackFilterFields(): MemoryFilterField[] {
	const messages = getMessage();
	return [
		{ key: "userId", label: messages.MEMORY_USER_FILTER, allowCustom: true },
		{ key: "sessionId", label: messages.MEMORY_SESSION_FILTER, allowCustom: true },
		{ key: "agentId", label: messages.MEMORY_AGENT_FILTER, allowCustom: true },
	];
}

function resolveFilterFields(type: string): MemoryFilterField[] {
	const described = getMemoryTypeDescriptor(type);
	if (described && described.filterFields !== undefined) {
		return described.filterFields;
	}
	return fallbackFilterFields();
}

function uniqueChoices(choices: MemoryFilterChoice[]): MemoryFilterChoice[] {
	const seen = new Set<string>();
	const next: MemoryFilterChoice[] = [];
	for (const choice of choices) {
		if (!choice.id || seen.has(choice.id)) continue;
		seen.add(choice.id);
		next.push(choice);
	}
	return next.sort((a, b) => a.label.localeCompare(b.label));
}

function mergeFilters(
	base: MemoryFilterOptions,
	extra: MemoryFilterOptions
): MemoryFilterOptions {
	return {
		users: uniqueChoices([...base.users, ...extra.users]),
		sessions: uniqueChoices([...base.sessions, ...extra.sessions]),
		agents: uniqueChoices([...base.agents, ...extra.agents]),
	};
}

function filtersFromScope(filter: {
	userId?: string;
	sessionId?: string;
	agentId?: string;
}): MemoryFilterOptions {
	return {
		users: filter.userId ? [{ id: filter.userId, label: filter.userId }] : [],
		sessions: filter.sessionId
			? [
					{
						id: filter.sessionId,
						label: filter.sessionId,
						userId: filter.userId,
					},
				]
			: [],
		agents: filter.agentId ? [{ id: filter.agentId, label: filter.agentId }] : [],
	};
}

function rememberedAsFilters(
	remembered: RememberedMemoryFilters
): MemoryFilterOptions {
	return {
		users: uniqueChoices(
			remembered.users.map((id) => ({ id, label: id }))
		),
		sessions: uniqueChoices(
			remembered.sessions.map((id) => ({ id, label: id }))
		),
		agents: uniqueChoices(
			remembered.agents.map((id) => ({ id, label: id }))
		),
	};
}

function knownFilters(
	base: MemoryFilterOptions,
	remembered: RememberedMemoryFilters,
	filter: { userId?: string; sessionId?: string; agentId?: string },
	records: MemoryRecord[] = []
): MemoryFilterOptions {
	return mergeFilters(
		mergeFilters(
			mergeFilters(base, rememberedAsFilters(remembered)),
			filtersFromScope(filter)
		),
		filtersFromMemories(records)
	);
}

function idsToRemember(
	filter: { userId?: string; sessionId?: string; agentId?: string },
	records: MemoryRecord[]
): RememberedMemoryFilters {
	return {
		users: [
			...(filter.userId ? [filter.userId] : []),
			...records.map((record) => record.userId?.trim() || ""),
		].filter(Boolean),
		sessions: [
			...(filter.sessionId ? [filter.sessionId] : []),
			...records.map((record) => record.sessionId?.trim() || ""),
		].filter(Boolean),
		agents: [
			...(filter.agentId ? [filter.agentId] : []),
			...records.map((record) => record.agentId?.trim() || ""),
		].filter(Boolean),
	};
}

function filtersFromMemories(records: MemoryRecord[]): MemoryFilterOptions {
	return {
		users: uniqueChoices(
			records
				.map((record) => record.userId?.trim())
				.filter((id): id is string => !!id)
				.map((id) => ({ id, label: id }))
		),
		sessions: uniqueChoices(
			records
				.filter((record) => record.sessionId?.trim())
				.map((record) => ({
					id: String(record.sessionId).trim(),
					label: String(record.sessionId).trim(),
					userId: record.userId?.trim(),
				}))
		),
		agents: uniqueChoices(
			records
				.map((record) => record.agentId?.trim())
				.filter((id): id is string => !!id)
				.map((id) => ({ id, label: id }))
		),
	};
}

function vendorStatus(error: unknown): number | undefined {
	if (error instanceof SourceResponseError) return error.status;
	const status = (error as { status?: unknown })?.status;
	return typeof status === "number" ? status : undefined;
}

function hintFromListError(error: unknown): MemoryQueryHint {
	const message = error instanceof Error ? error.message : String(error);
	if (message === MEMORY_CONNECTOR_SESSION_REQUIRED) return "session_required";
	if (message === MEMORY_CONNECTOR_FILTER_REQUIRED) return "filter_required";
	if (/one of the filters:.*is required/i.test(message)) return "filter_required";
	const status = vendorStatus(error);
	if (
		status === 401 ||
		status === 403 ||
		message === DATA_SOURCE_SECRET_DECRYPT_FAILED ||
		message === DATA_SOURCE_SECRET_NOT_FOUND ||
		message === DATA_SOURCE_SECRET_UNAVAILABLE ||
		/invalid.*api key|authentication_error|authentication failed/i.test(message)
	) {
		return "auth_failed";
	}
	return "unavailable";
}

async function safeListFilters(adapter: MemoryAdapter): Promise<MemoryFilterOptions> {
	try {
		if (typeof adapter.listFilters !== "function") return emptyMemoryFilters();
		const filters = await adapter.listFilters();
		return mergeFilters(emptyMemoryFilters(), filters || emptyMemoryFilters());
	} catch {
		return emptyMemoryFilters();
	}
}

function emptyResult(partial: {
	connectors: MemoryQueryResult["connectors"];
	connector: MemoryQueryResult["connector"];
	capabilities: MemoryCapabilities | null;
	filters?: MemoryFilterOptions;
	filterFields?: MemoryFilterField[];
	hint?: MemoryQueryHint;
}): MemoryQueryResult {
	return {
		connectors: partial.connectors,
		connector: partial.connector,
		capabilities: partial.capabilities,
		memories: [],
		stats: emptyMemoryStats(),
		graph: { nodes: [], edges: [] },
		filters: partial.filters || emptyMemoryFilters(),
		filterFields: partial.filterFields || [],
		hint: partial.hint,
	};
}

export async function queryProjectMemories(
	input: MemoryQueryInput = {}
): Promise<MemoryQueryResult> {
	const connectors = await listMemoryConnectors();
	if (!connectors.length) {
		return emptyResult({
			connectors: [],
			connector: null,
			capabilities: null,
		});
	}

	let connector = connectors[0];
	if (input.connectorId) {
		const requested = memoryConnectorId(input.connectorId);
		const match = connectors.find((item) => item.id === requested);
		if (!match) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
		connector = match;
	}

	const { adapter } = await getMemoryRuntime(String(connector.id));
	const capabilities = adapter.capabilities();
	const filterFields = resolveFilterFields(String(connector.type || ""));
	const limit = clampLimit(input.limit);
	const filter = {
		userId: trim(input.userId),
		agentId: trim(input.agentId),
		sessionId: trim(input.sessionId),
		limit,
	};
	const query = trim(input.query);
	const filters = await safeListFilters(adapter);
	const remembered = await readRememberedMemoryFilters(String(connector.id)).catch(
		() => emptyRememberedMemoryFilters()
	);

	let records: MemoryRecord[] = [];
	if (query) {
		if (!capabilities.search) {
			throw new Error(MEMORY_CONNECTOR_QUERY_REQUIRED);
		}
		try {
			records = await adapter.search({ query, ...filter, limit });
		} catch (error) {
			return emptyResult({
				connectors,
				connector,
				capabilities,
				filters: knownFilters(filters, remembered, filter),
				filterFields,
				hint: hintFromListError(error),
			});
		}
	} else {
		try {
			records = await adapter.list(filter);
		} catch (error) {
			return emptyResult({
				connectors,
				connector,
				capabilities,
				filters: knownFilters(filters, remembered, filter),
				filterFields,
				hint: hintFromListError(error),
			});
		}
	}

	await rememberMemoryFilters(
		String(connector.id),
		idsToRemember(filter, records)
	).catch(() => undefined);

	const memories = attachMemoryPorts(
		records
			.filter((record) => !record.graphOnly)
			.map((record) => ({
				...record,
				kind: classifyMemoryKind(record),
			})),
		await readMemoryPortLinks(String(connector.id)).catch(() => [])
	);

	const described = getMemoryTypeDescriptor(String(connector.type || ""));
	const connectorsWithCopyMeta = connectors.map((item) => {
		const type = getMemoryTypeDescriptor(String(item.type || ""));
		return {
			...item,
			capabilities: type?.capabilities || null,
			filterFields: type?.filterFields || [],
		};
	});

	return {
		connectors: connectorsWithCopyMeta,
		connector: {
			...connector,
			capabilities: described?.capabilities || null,
			filterFields: described?.filterFields || [],
		},
		capabilities,
		memories,
		stats: summarizeMemoryStats(memories),
		graph: buildMemoryGraph(records),
		filters: knownFilters(filters, remembered, filter, records),
		filterFields,
	};
}

export async function resolveProjectMemoryAdapter(connectorId?: string) {
	const connectors = await listMemoryConnectors();
	if (!connectors.length) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);

	let connector = connectors[0];
	if (connectorId) {
		const requested = memoryConnectorId(connectorId);
		const match = connectors.find((item) => item.id === requested);
		if (!match) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
		connector = match;
	}

	const { adapter } = await getMemoryRuntime(String(connector.id));
	return {
		connector,
		adapter,
		capabilities: adapter.capabilities(),
	};
}

export function asMemoryListItem(record: MemoryRecord): MemoryListItem {
	return {
		...record,
		kind: classifyMemoryKind(record),
	};
}

export async function getProjectMemory(input: {
	id: string;
	connectorId?: string;
}): Promise<MemoryDetailResult> {
	const id = trim(input.id);
	if (!id) throw new Error(MEMORY_DETAIL_NOT_FOUND);

	const { connector, adapter, capabilities } = await resolveProjectMemoryAdapter(
		input.connectorId
	);
	if (!capabilities.get) {
		return { connector, capabilities, memory: null, hint: "get_unsupported" };
	}

	let record: MemoryRecord | null;
	try {
		record = await adapter.get(id);
	} catch (error) {
		if (error instanceof UnsupportedMemoryCapabilityError) {
			return { connector, capabilities, memory: null, hint: "get_unsupported" };
		}
		throw error;
	}
	if (!record) throw new Error(MEMORY_DETAIL_NOT_FOUND);

	const [withPort] = attachMemoryPorts(
		[record],
		await readMemoryPortLinks(String(connector.id)).catch(() => [])
	);

	return {
		connector,
		capabilities,
		memory: asMemoryListItem(withPort),
	};
}

export async function submitProjectMemoryFeedback(input: {
	id: string;
	connectorId?: string;
	rating: MemoryFeedbackRating | null;
	reason?: string | null;
}): Promise<MemoryFeedbackResult> {
	const id = trim(input.id);
	if (!id) throw new Error(MEMORY_DETAIL_NOT_FOUND);
	if (input.rating !== null && !isMemoryFeedbackRating(input.rating)) {
		throw new Error(MEMORY_FEEDBACK_INVALID);
	}
	const reason = input.reason == null ? undefined : String(input.reason).trim();
	if (reason && reason.length > FEEDBACK_REASON_MAX) {
		throw new Error(MEMORY_FEEDBACK_REASON_TOO_LONG);
	}

	const { connector, adapter, capabilities } = await resolveProjectMemoryAdapter(
		input.connectorId
	);
	if (!capabilities.feedback) {
		throw new Error(MEMORY_DETAIL_FEEDBACK_UNSUPPORTED);
	}

	const payload: MemoryFeedbackInput = {
		rating: input.rating,
		reason: reason || null,
	};
	let feedback: MemoryFeedback;
	try {
		feedback = await adapter.feedback(id, payload);
	} catch (error) {
		if (error instanceof UnsupportedMemoryCapabilityError) {
			throw new Error(MEMORY_DETAIL_FEEDBACK_UNSUPPORTED);
		}
		throw error;
	}

	let memory: MemoryListItem | null = null;
	if (capabilities.get) {
		try {
			const record = await adapter.get(id);
			if (record) {
				memory = asMemoryListItem({
					...record,
					feedback: record.feedback || feedback,
				});
			}
		} catch {
			memory = null;
		}
	}

	return { connector, capabilities, feedback, memory };
}
