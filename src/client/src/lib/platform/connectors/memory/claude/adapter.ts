/**
 * Claude (Anthropic) memory connector.
 *
 * Talks to Anthropic Memory Stores (`https://api.anthropic.com`) using the
 * `agent-memory-2026-07-22` beta. Stores are exposed as session filters; there
 * is no dedicated search endpoint, so search filters listed memories locally.
 */

import getMessage from "@/constants/messages";
import type { ConnectorHealthResult } from "../../types";
import type { ResolvedSecret } from "../../datasource/http/secret";
import { BaseMemoryAdapter } from "../base-adapter";
import { memoryHttpVendorFields, memoryPageFilters } from "../config-fields";
import { memoryBaseUrl, memoryRequest } from "../http";
import type {
	MemoryCapabilities,
	MemoryFilterOptions,
	MemoryHistoryEvent,
	MemoryListFilter,
	MemoryRecord,
	MemorySearchQuery,
	MemorySourceDescriptor,
	MemoryTypeDescriptor,
	MemoryUpdateInput,
	MemoryWriteInput,
} from "../types";
import { emptyMemoryFilters } from "../types";

const DEFAULT_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const MEMORY_BETA = "agent-memory-2026-07-22";
const FULL_VIEW_LIMIT = 20;
const MAX_PAGES = 8;

const CLAUDE_CAPABILITIES: MemoryCapabilities = {
	add: true,
	search: true,
	get: true,
	list: true,
	update: true,
	delete: true,
	feedback: false,
};

const HISTORY_EVENTS: Record<string, string> = {
	created: "ADD",
	modified: "UPDATE",
	deleted: "DELETE",
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

function objectValue(value: unknown): Record<string, unknown> | undefined {
	const record = asRecord(value);
	return Object.keys(record).length ? record : undefined;
}

function slug(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "memory"
	);
}

function setting(descriptor: MemorySourceDescriptor, key: string): string | undefined {
	return stringValue(descriptor.settings[key]);
}

function encodeMemoryRef(storeId: string, memoryId: string): string {
	return `${storeId}:${memoryId}`;
}

function parseMemoryRef(
	id: string,
	configuredStore?: string
): { storeId: string; memoryId: string } | null {
	const trimmed = id.trim();
	if (!trimmed) return null;
	const colon = trimmed.indexOf(":");
	if (colon > 0) {
		const storeId = trimmed.slice(0, colon).trim();
		const memoryId = trimmed.slice(colon + 1).trim();
		if (storeId && memoryId) return { storeId, memoryId };
	}
	if (configuredStore) return { storeId: configuredStore, memoryId: trimmed };
	return null;
}

function pathCategories(path: string | undefined): string[] | undefined {
	if (!path) return undefined;
	const segments = path
		.split("/")
		.map((part) => part.trim())
		.filter(Boolean);
	return segments.length ? segments : undefined;
}

function storeUserId(metadata: Record<string, unknown> | undefined): string | undefined {
	if (!metadata) return undefined;
	return (
		stringValue(metadata.user_id) ||
		stringValue(metadata.userId) ||
		stringValue(metadata.user)
	);
}

function actorId(raw: unknown): string | undefined {
	const actor = asRecord(raw);
	return (
		stringValue(actor.session_id) ||
		stringValue(actor.api_key_id) ||
		stringValue(actor.user_id)
	);
}

function writeContent(input: MemoryWriteInput): string {
	const content = stringValue(input.content);
	if (content) return content;
	const joined = (input.messages || [])
		.map((message) => stringValue(message.content))
		.filter((item): item is string => !!item)
		.join("\n")
		.trim();
	return joined;
}

function writePath(input: MemoryWriteInput, content: string): string {
	const raw = stringValue(input.metadata?.path);
	if (raw) return raw.startsWith("/") ? raw : `/${raw}`;
	return `/openlit/${slug(content)}.md`;
}

function matchesQuery(record: MemoryRecord, query: string): boolean {
	const haystack = [
		record.content,
		record.id,
		...(record.categories || []),
		...Object.values(record.metadata || {}).map((value) => String(value)),
	]
		.join(" ")
		.toLowerCase();
	return haystack.includes(query.toLowerCase());
}

function normalizeRecord(
	raw: unknown,
	extras: { storeId?: string; userId?: string; history?: MemoryHistoryEvent[] } = {}
): MemoryRecord | null {
	const row = asRecord(raw);
	if (stringValue(row.type) === "memory_prefix") return null;
	const memoryId = stringValue(row.id);
	const storeId =
		stringValue(row.memory_store_id) || extras.storeId;
	if (!memoryId || !storeId) return null;
	const path = stringValue(row.path);
	const content = stringValue(row.content) || path || "";
	const versionId = stringValue(row.memory_version_id);
	const sha = stringValue(row.content_sha256);
	return {
		id: encodeMemoryRef(storeId, memoryId),
		content,
		userId: extras.userId,
		sessionId: storeId,
		categories: pathCategories(path),
		metadata: {
			...(path ? { path } : {}),
			memory_id: memoryId,
			memory_store_id: storeId,
			...(versionId ? { memory_version_id: versionId } : {}),
			...(sha ? { content_sha256: sha } : {}),
			...(typeof row.content_size_bytes === "number"
				? { content_size_bytes: row.content_size_bytes }
				: {}),
		},
		history: extras.history,
		createdAt: stringValue(row.created_at),
		updatedAt: stringValue(row.updated_at),
	};
}

function normalizeHistory(raw: unknown): MemoryHistoryEvent[] {
	const body = asRecord(raw);
	const rows = Array.isArray(raw)
		? raw
		: Array.isArray(body.data)
			? body.data
			: [];
	const events: MemoryHistoryEvent[] = [];
	for (const item of rows) {
		const row = asRecord(item);
		const operation = stringValue(row.operation) || "";
		const event = HISTORY_EVENTS[operation] || operation.toUpperCase() || "UPDATE";
		const content = stringValue(row.content);
		events.push({
			id: stringValue(row.id),
			event,
			newMemory: content,
			createdAt: stringValue(row.created_at),
			actorId: actorId(row.created_by),
		});
	}
	return events;
}

function pageRows(raw: unknown): unknown[] {
	const body = asRecord(raw);
	return Array.isArray(body.data) ? body.data : Array.isArray(raw) ? raw : [];
}

function nextPage(raw: unknown): string | undefined {
	return stringValue(asRecord(raw).next_page);
}

export class ClaudeAdapter extends BaseMemoryAdapter {
	readonly type = "claude";

	private get baseUrl(): string {
		return memoryBaseUrl(this.descriptor, DEFAULT_URL);
	}

	private get configuredStoreId(): string | undefined {
		return setting(this.descriptor, "storeId");
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
				const apiKey = secret.credentials.apiKey || secret.raw;
				return {
					"anthropic-version": ANTHROPIC_VERSION,
					"anthropic-beta": MEMORY_BETA,
					...(apiKey ? { "x-api-key": apiKey } : {}),
				};
			},
		});
	}

	private async collectPages(
		buildPath: (page?: string) => string,
		maxPages = MAX_PAGES
	): Promise<unknown[]> {
		const rows: unknown[] = [];
		let page: string | undefined;
		for (let i = 0; i < maxPages; i++) {
			const body = await this.request(buildPath(page));
			rows.push(...pageRows(body));
			const next = nextPage(body);
			if (!next) break;
			page = next;
		}
		return rows;
	}

	private async listStores(): Promise<
		{ id: string; name: string; userId?: string }[]
	> {
		const rows = await this.collectPages((page) => {
			const params = new URLSearchParams();
			params.set("limit", "100");
			if (page) params.set("page", page);
			return `v1/memory_stores?${params.toString()}`;
		});
		const stores: { id: string; name: string; userId?: string }[] = [];
		for (const item of rows) {
			const row = asRecord(item);
			const id = stringValue(row.id);
			if (!id) continue;
			stores.push({
				id,
				name: stringValue(row.name) || id,
				userId: storeUserId(objectValue(row.metadata)),
			});
		}
		return stores;
	}

	private async resolveStoreId(filter: {
		sessionId?: string;
		userId?: string;
	}): Promise<string> {
		const selected = stringValue(filter.sessionId) || this.configuredStoreId;
		if (selected) return selected;
		const stores = await this.listStores();
		const scoped = filter.userId
			? stores.filter((store) => store.userId === filter.userId)
			: stores;
		if (scoped.length === 1) return scoped[0].id;
		throw new Error(getMessage().MEMORY_CONNECTOR_FILTER_REQUIRED);
	}

	private async listMemories(
		storeId: string,
		extras: { userId?: string }
	): Promise<MemoryRecord[]> {
		const rows = await this.collectPages((page) => {
			const params = new URLSearchParams();
			params.set("path_prefix", "/");
			params.set("view", "full");
			params.set("limit", String(FULL_VIEW_LIMIT));
			if (page) params.set("page", page);
			return `v1/memory_stores/${encodeURIComponent(storeId)}/memories?${params.toString()}`;
		});
		return rows
			.map((row) => normalizeRecord(row, { storeId, userId: extras.userId }))
			.filter((row): row is MemoryRecord => !!row);
	}

	capabilities(): MemoryCapabilities {
		return { ...CLAUDE_CAPABILITIES };
	}

	async healthCheck(): Promise<ConnectorHealthResult> {
		const started = Date.now();
		try {
			const storeId = this.configuredStoreId;
			if (storeId) {
				await this.request(`v1/memory_stores/${encodeURIComponent(storeId)}`, {
					timeoutMs: 10_000,
				});
			} else {
				const params = new URLSearchParams();
				params.set("limit", "1");
				await this.request(`v1/memory_stores?${params.toString()}`, {
					timeoutMs: 10_000,
				});
			}
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
		const content = writeContent(input);
		if (!content) {
			throw new Error(getMessage().MEMORY_CONNECTOR_CONTENT_REQUIRED);
		}
		const storeId = await this.resolveStoreId(input);
		const body = await this.request(
			`v1/memory_stores/${encodeURIComponent(storeId)}/memories`,
			{
				method: "POST",
				body: {
					path: writePath(input, content),
					content,
				},
			}
		);
		const record = normalizeRecord(body, { storeId, userId: input.userId });
		return record ? [record] : [];
	}

	async search(query: MemorySearchQuery): Promise<MemoryRecord[]> {
		const q = query.query.trim();
		if (!q) throw new Error(getMessage().MEMORY_CONNECTOR_QUERY_REQUIRED);
		const records = await this.list(query);
		return records.filter((record) => matchesQuery(record, q));
	}

	async get(id: string): Promise<MemoryRecord | null> {
		const ref = parseMemoryRef(id, this.configuredStoreId);
		if (!ref) return null;
		const body = await this.request(
			`v1/memory_stores/${encodeURIComponent(ref.storeId)}/memories/${encodeURIComponent(ref.memoryId)}?view=full`
		);
		let history: MemoryHistoryEvent[] = [];
		try {
			const params = new URLSearchParams();
			params.set("memory_id", ref.memoryId);
			params.set("view", "full");
			params.set("limit", "50");
			history = normalizeHistory(
				await this.request(
					`v1/memory_stores/${encodeURIComponent(ref.storeId)}/memory_versions?${params.toString()}`
				)
			);
		} catch {
			history = [];
		}
		return normalizeRecord(body, { storeId: ref.storeId, history });
	}

	async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
		const storeId = await this.resolveStoreId(filter);
		const records = await this.listMemories(storeId, { userId: filter.userId });
		return records.slice(0, filter.limit || 50);
	}

	async listFilters(): Promise<MemoryFilterOptions> {
		const filters = emptyMemoryFilters();
		try {
			const stores = await this.listStores();
			const users = new Map<string, string>();
			filters.sessions = stores.map((store) => {
				if (store.userId) users.set(store.userId, store.userId);
				return {
					id: store.id,
					label: store.name,
					userId: store.userId,
				};
			});
			filters.users = [...users.entries()].map(([id, label]) => ({ id, label }));
		} catch {
			return emptyMemoryFilters();
		}
		return filters;
	}

	async update(id: string, input: MemoryUpdateInput): Promise<MemoryRecord> {
		const ref = parseMemoryRef(id, this.configuredStoreId);
		if (!ref) throw new Error(getMessage().MEMORY_DETAIL_NOT_FOUND);
		const path = stringValue(input.metadata?.path);
		const body = await this.request(
			`v1/memory_stores/${encodeURIComponent(ref.storeId)}/memories/${encodeURIComponent(ref.memoryId)}?view=full`,
			{
				method: "POST",
				body: {
					content: input.content,
					...(path ? { path: path.startsWith("/") ? path : `/${path}` } : {}),
				},
			}
		);
		return (
			normalizeRecord(body, { storeId: ref.storeId }) || {
				id: encodeMemoryRef(ref.storeId, ref.memoryId),
				content: input.content,
				sessionId: ref.storeId,
				metadata: input.metadata,
			}
		);
	}

	async delete(id: string): Promise<void> {
		const ref = parseMemoryRef(id, this.configuredStoreId);
		if (!ref) throw new Error(getMessage().MEMORY_DETAIL_NOT_FOUND);
		await this.request(
			`v1/memory_stores/${encodeURIComponent(ref.storeId)}/memories/${encodeURIComponent(ref.memoryId)}`,
			{ method: "DELETE" }
		);
	}
}

export const claudeAdapterFactory = {
	type: "claude",
	create: (descriptor: MemorySourceDescriptor) => new ClaudeAdapter(descriptor),
	describe: (): MemoryTypeDescriptor => ({
		type: "claude",
		displayName: "Claude",
		description: getMessage().MEMORY_CONNECTOR_CLAUDE_DESCRIPTION,
		capabilities: { ...CLAUDE_CAPABILITIES },
		configFields: [...memoryHttpVendorFields({ placeholder: DEFAULT_URL })],
		filterFields: memoryPageFilters([
			"userId",
			{
				key: "sessionId",
				label: getMessage().MEMORY_CONNECTOR_FIELD_STORE_ID,
				required: true,
			},
		]),
		authStyle: "api-key",
		authHelp: getMessage().MEMORY_CONNECTOR_AUTH_HELP_CLAUDE,
		docsUrl: "https://platform.claude.com/docs/en/managed-agents/memory",
	}),
};
