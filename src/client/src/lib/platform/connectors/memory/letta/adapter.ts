/**
 * Letta (MemGPT) memory connector.
 *
 * Talks to the Letta REST API (hosted `https://api.letta.com` or a self-hosted
 * Letta server) and reads agent archival memory — the passages an agent writes
 * with its own `archival_memory_*` tools. Passages live under an agent, so
 * every call needs an agent id. No Letta route reads or edits one passage, and
 * the list cursors (`before`/`after`) are strict, so a single passage cannot be
 * addressed at all: `get` and `update` stay unsupported.
 */

import getMessage from "@/constants/messages";
import type { ConnectorHealthResult } from "../../types";
import type { ResolvedSecret } from "../../datasource/http/secret";
import { BaseMemoryAdapter } from "../base-adapter";
import { memoryHttpVendorFields, memoryPageFilters } from "../config-fields";
import { memoryBaseUrl, memoryRequest } from "../http";
import type {
	MemoryCapabilities,
	MemoryFilterChoice,
	MemoryFilterOptions,
	MemoryListFilter,
	MemoryRecord,
	MemorySearchQuery,
	MemorySourceDescriptor,
	MemoryTypeDescriptor,
	MemoryWriteInput,
} from "../types";
import { emptyMemoryFilters } from "../types";

const DEFAULT_URL = "https://api.letta.com";
const AGENT_PAGE_SIZE = 100;
const DEFAULT_LIST_LIMIT = 25;
const DEFAULT_SEARCH_LIMIT = 10;

const LETTA_CAPABILITIES: MemoryCapabilities = {
	add: true,
	search: true,
	get: false,
	list: true,
	update: false,
	delete: true,
	feedback: false,
};

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringValue(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => stringValue(item))
		.filter((item): item is string => !!item);
}

function rowsFrom(raw: unknown, keys: string[]): unknown[] {
	if (Array.isArray(raw)) return raw;
	const body = asRecord(raw);
	for (const key of keys) {
		const value = body[key];
		if (Array.isArray(value)) return value;
	}
	return [];
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

/** Passage ids are only addressable through their agent, and delete needs both. */
function encodeMemoryRef(agentId: string, passageId: string): string {
	return `${agentId}:${passageId}`;
}

function parseMemoryRef(
	id: string
): { agentId: string; passageId: string } | null {
	const trimmed = id.trim();
	const colon = trimmed.indexOf(":");
	if (colon <= 0) return null;
	const agentId = trimmed.slice(0, colon).trim();
	const passageId = trimmed.slice(colon + 1).trim();
	if (!agentId || !passageId) return null;
	return { agentId, passageId };
}

function requireAgentId(scope: { agentId?: string }, message: string): string {
	const agentId = scope.agentId?.trim();
	if (!agentId) throw new Error(message);
	return agentId;
}

function writeContent(input: MemoryWriteInput): string {
	const content = stringValue(input.content);
	if (content) return content;
	return (input.messages || [])
		.map((message) => stringValue(message.content))
		.filter((item): item is string => !!item)
		.join("\n")
		.trim();
}

/**
 * Letta's create body is `{ text, tags }` — it has no metadata field, so
 * `metadata.tags` is the only key a write can keep. The capability footnote in
 * docs/latest/openlit/connectors/memory.mdx says so.
 */
function writeTags(input: MemoryWriteInput): string[] {
	return stringList(input.metadata?.tags);
}

/**
 * A passage arrives either whole (`text`, `created_at`) from the list endpoint
 * or as a trimmed search hit (`content`, `timestamp`). Neither route scores a
 * hit, so `score` stays unset.
 */
function normalizeRecord(raw: unknown, agentId: string): MemoryRecord | null {
	const row = asRecord(raw);
	const passageId = stringValue(row.id);
	const content = stringValue(row.text) || stringValue(row.content) || "";
	if (!passageId || !content) return null;
	const tags = stringList(row.tags);
	const archiveId = stringValue(row.archive_id);
	const fileName = stringValue(row.file_name);
	return {
		id: encodeMemoryRef(agentId, passageId),
		content,
		agentId,
		metadata: {
			...asRecord(row.metadata),
			passage_id: passageId,
			...(archiveId ? { archive_id: archiveId } : {}),
			...(fileName ? { file_name: fileName } : {}),
		},
		categories: tags.length ? tags : undefined,
		createdAt: stringValue(row.created_at) || stringValue(row.timestamp),
		updatedAt: stringValue(row.updated_at),
	};
}

function normalizeList(raw: unknown, agentId: string): MemoryRecord[] {
	return rowsFrom(raw, ["results", "passages", "data"])
		.map((row) => normalizeRecord(row, agentId))
		.filter((row): row is MemoryRecord => !!row);
}

/**
 * Normalize what a create returned. The text may become several passages, so
 * servers answer with a list, but a single passage is also answered as a bare
 * object depending on the version and the route. `rowsFrom()` reads a bare
 * object as "no rows", which would report a successful write as nothing
 * written, so fall back to reading it as the one passage it is.
 */
function normalizeWritten(raw: unknown, agentId: string): MemoryRecord[] {
	const rows = normalizeList(raw, agentId);
	if (rows.length) return rows;
	const single = normalizeRecord(raw, agentId);
	return single ? [single] : [];
}

function normalizeAgents(raw: unknown): MemoryFilterChoice[] {
	return uniqueChoices(
		rowsFrom(raw, ["agents", "results", "data"]).map((item) => {
			const row = asRecord(item);
			const id = stringValue(row.id) || "";
			return { id, label: stringValue(row.name) || id };
		})
	);
}

export class LettaAdapter extends BaseMemoryAdapter {
	readonly type = "letta";

	private get baseUrl(): string {
		return memoryBaseUrl(this.descriptor, DEFAULT_URL);
	}

	private request<T>(
		path: string,
		opts: {
			method?: string;
			body?: unknown;
			timeoutMs?: number;
		} = {}
	) {
		return memoryRequest<T>(this.descriptor, this.baseUrl, path, {
			...opts,
			authHeaders: (secret: ResolvedSecret): Record<string, string> => {
				// Letta Cloud API keys and a self-hosted server password both ride
				// the same bearer header; an unsecured server needs none.
				const apiKey = secret.credentials.apiKey || secret.raw;
				return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
			},
		});
	}

	private async requestFirst<T>(
		paths: string[],
		opts: {
			method?: string;
			body?: unknown;
			timeoutMs?: number;
		} = {}
	): Promise<T> {
		let last: unknown;
		for (const path of paths) {
			try {
				return await this.request<T>(path, opts);
			} catch (error) {
				last = error;
			}
		}
		throw last instanceof Error ? last : new Error(String(last));
	}

	capabilities(): MemoryCapabilities {
		return { ...LETTA_CAPABILITIES };
	}

	async healthCheck(): Promise<ConnectorHealthResult> {
		const started = Date.now();
		try {
			// Only an authenticated route can prove the credential. `/v1/health/`
			// is deliberately unauthenticated on Letta Cloud and on a self-hosted
			// server, so it answers 200 for a wrong, expired or missing API key
			// and must never stand in for this probe.
			await this.request("v1/agents/?limit=1", { timeoutMs: 10_000 });
			return { ok: true, latencyMs: Date.now() - started };
		} catch (error) {
			return {
				ok: false,
				latencyMs: Date.now() - started,
				message: String((error as Error)?.message || error),
			};
		}
	}

	async add(input: MemoryWriteInput): Promise<MemoryRecord[]> {
		const agentId = requireAgentId(
			input,
			getMessage().MEMORY_CONNECTOR_AGENT_REQUIRED
		);
		const text = writeContent(input);
		if (!text) throw new Error(getMessage().MEMORY_CONNECTOR_CONTENT_REQUIRED);
		const tags = writeTags(input);
		const body = await this.request(
			`v1/agents/${encodeURIComponent(agentId)}/archival-memory`,
			{
				method: "POST",
				body: { text, ...(tags.length ? { tags } : {}) },
			}
		);
		return normalizeWritten(body, agentId);
	}

	async search(query: MemorySearchQuery): Promise<MemoryRecord[]> {
		const q = query.query.trim();
		if (!q) throw new Error(getMessage().MEMORY_CONNECTOR_QUERY_REQUIRED);
		const agentId = requireAgentId(
			query,
			getMessage().MEMORY_CONNECTOR_FILTER_REQUIRED
		);
		const limit = query.limit || DEFAULT_SEARCH_LIMIT;
		const agent = encodeURIComponent(agentId);
		const semantic = new URLSearchParams({ query: q, top_k: String(limit) });
		const text = new URLSearchParams({ search: q, limit: String(limit) });
		// Embedding search is its own route; servers without it still filter the
		// list endpoint by text.
		const body = await this.requestFirst([
			`v1/agents/${agent}/archival-memory/search?${semantic.toString()}`,
			`v1/agents/${agent}/archival-memory?${text.toString()}`,
		]);
		return normalizeList(body, agentId).slice(0, limit);
	}

	async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
		const agentId = requireAgentId(
			filter,
			getMessage().MEMORY_CONNECTOR_FILTER_REQUIRED
		);
		const limit = filter.limit || DEFAULT_LIST_LIMIT;
		const params = new URLSearchParams({
			limit: String(limit),
			// Letta pages passages oldest-first; the memory list reads newest-first.
			ascending: "false",
		});
		const body = await this.request(
			`v1/agents/${encodeURIComponent(agentId)}/archival-memory?${params.toString()}`
		);
		return normalizeList(body, agentId).slice(0, limit);
	}

	async listFilters(): Promise<MemoryFilterOptions> {
		const filters = emptyMemoryFilters();
		try {
			filters.agents = normalizeAgents(
				await this.request(`v1/agents/?limit=${AGENT_PAGE_SIZE}`)
			);
		} catch {
			filters.agents = [];
		}
		return filters;
	}

	async delete(id: string): Promise<void> {
		const ref = parseMemoryRef(id);
		if (!ref) throw new Error(getMessage().MEMORY_DETAIL_NOT_FOUND);
		await this.request(
			`v1/agents/${encodeURIComponent(ref.agentId)}/archival-memory/${encodeURIComponent(ref.passageId)}`,
			{ method: "DELETE" }
		);
	}
}

export const lettaAdapterFactory = {
	type: "letta",
	create: (descriptor: MemorySourceDescriptor) => new LettaAdapter(descriptor),
	describe: (): MemoryTypeDescriptor => ({
		type: "letta",
		displayName: "Letta",
		description: getMessage().MEMORY_CONNECTOR_LETTA_DESCRIPTION,
		capabilities: { ...LETTA_CAPABILITIES },
		configFields: memoryHttpVendorFields({ placeholder: DEFAULT_URL }),
		filterFields: memoryPageFilters([{ key: "agentId", required: true }]),
		authStyle: "api-key",
		authHelp: getMessage().MEMORY_CONNECTOR_AUTH_HELP_LETTA,
		docsUrl: "https://docs.letta.com/api-reference",
	}),
};
