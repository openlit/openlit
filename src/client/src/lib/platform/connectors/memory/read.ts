/**
 * Project-scoped memory reads for the Memory page and Otter tools.
 */

import {
	getMemoryRuntime,
	listMemoryConnectors,
	memoryConnectorId,
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
	type MemoryFilterChoice,
	type MemoryFilterOptions,
	type MemoryQueryHint,
	type MemoryRecord,
} from "./types";
import {
	MEMORY_CONNECTOR_FILTER_REQUIRED,
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_CONNECTOR_QUERY_REQUIRED,
	MEMORY_CONNECTOR_SESSION_REQUIRED,
	MEMORY_DETAIL_NOT_FOUND,
} from "@/constants/messages/en";

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

export interface MemoryQueryResult {
	connectors: Awaited<ReturnType<typeof listMemoryConnectors>>;
	connector: Awaited<ReturnType<typeof listMemoryConnectors>>[number] | null;
	capabilities: MemoryCapabilities | null;
	memories: MemoryListItem[];
	stats: MemoryStats;
	graph: MemoryGraphModel;
	filters: MemoryFilterOptions;
	hint?: MemoryQueryHint;
}

export interface MemoryDetailResult {
	connector: MemoryQueryResult["connector"];
	capabilities: MemoryCapabilities | null;
	memory: MemoryListItem | null;
	hint?: "get_unsupported";
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function trim(value?: string): string | undefined {
	const next = String(value || "").trim();
	return next || undefined;
}

function clampLimit(value?: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
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

function hintFromListError(error: unknown): MemoryQueryHint | undefined {
	const message = error instanceof Error ? error.message : String(error);
	if (message === MEMORY_CONNECTOR_SESSION_REQUIRED) return "session_required";
	if (message === MEMORY_CONNECTOR_FILTER_REQUIRED) return "filter_required";
	if (/one of the filters:.*is required/i.test(message)) return "filter_required";
	return undefined;
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
	const limit = clampLimit(input.limit);
	const filter = {
		userId: trim(input.userId),
		agentId: trim(input.agentId),
		sessionId: trim(input.sessionId),
		limit,
	};
	const query = trim(input.query);
	const filters = await safeListFilters(adapter);

	let records: MemoryRecord[] = [];
	if (query) {
		if (!capabilities.search) {
			throw new Error(MEMORY_CONNECTOR_QUERY_REQUIRED);
		}
		try {
			records = await adapter.search({ query, ...filter, limit });
		} catch (error) {
			const hint = hintFromListError(error);
			if (hint) {
				return emptyResult({ connectors, connector, capabilities, filters, hint });
			}
			throw error;
		}
	} else {
		try {
			records = await adapter.list(filter);
		} catch (error) {
			const hint = hintFromListError(error);
			if (hint) {
				return emptyResult({ connectors, connector, capabilities, filters, hint });
			}
			throw error;
		}
	}

	const memories = records.map((record) => ({
		...record,
		kind: classifyMemoryKind(record),
	}));

	return {
		connectors,
		connector,
		capabilities,
		memories,
		stats: summarizeMemoryStats(memories),
		graph: buildMemoryGraph(memories),
		filters: mergeFilters(filters, filtersFromMemories(records)),
	};
}

export async function getProjectMemory(input: {
	id: string;
	connectorId?: string;
}): Promise<MemoryDetailResult> {
	const id = trim(input.id);
	if (!id) throw new Error(MEMORY_DETAIL_NOT_FOUND);

	const connectors = await listMemoryConnectors();
	if (!connectors.length) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);

	let connector = connectors[0];
	if (input.connectorId) {
		const requested = memoryConnectorId(input.connectorId);
		const match = connectors.find((item) => item.id === requested);
		if (!match) throw new Error(MEMORY_CONNECTOR_NOT_FOUND);
		connector = match;
	}

	const { adapter } = await getMemoryRuntime(String(connector.id));
	const capabilities = adapter.capabilities();
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

	return {
		connector,
		capabilities,
		memory: {
			...record,
			kind: classifyMemoryKind(record),
		},
	};
}
