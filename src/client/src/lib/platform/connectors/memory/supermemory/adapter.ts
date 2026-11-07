/**
 * Supermemory memory connector.
 *
 * Talks to the Supermemory v5 API (hosted `https://api.supermemory.ai` or a
 * self-hosted server), where every route is scoped to one namespace
 * (`/ns/{namespace}/...`). The namespace is exposed as the user filter.
 *
 * Supermemory extracts memories from the documents you add, so `add` stores a
 * document and the memories derived from it appear in `list` and `search` once
 * Supermemory has processed it. v5 has no route that writes or edits a single
 * memory (the v4 routes are deprecated and removed in v5), so `update` stays
 * unsupported, and `delete` forgets the memory: it leaves `list` and search but
 * stays readable by id. There is no graph route in the public v5 API, so
 * `graph()` is not implemented. Memory ids are `<namespace>:<memoryId>` because
 * every route needs the namespace.
 */

import getMessage from "@/constants/messages";
import type { ConnectorHealthResult } from "../../types";
import { SourceResponseError } from "../../datasource/http/safe-fetch";
import type { ResolvedSecret } from "../../datasource/http/secret";
import { BaseMemoryAdapter } from "../base-adapter";
import { memoryHttpVendorFields, memoryPageFilters } from "../config-fields";
import { memoryBaseUrl, memoryRequest } from "../http";
import type {
	MemoryCapabilities,
	MemoryFilterOptions,
	MemoryHistoryEvent,
	MemoryListFilter,
	MemoryListPage,
	MemoryRecord,
	MemorySearchQuery,
	MemorySourceDescriptor,
	MemoryTypeDescriptor,
	MemoryWriteInput,
} from "../types";
import { emptyMemoryFilters } from "../types";
import {
	asRecord,
	requireArray,
	requireObject,
	stringValue,
	uniqueChoices,
	writeContent,
} from "../values";

const DEFAULT_URL = "https://api.supermemory.ai";
const DOCS_URL = "https://api.supermemory.ai/v5/reference"; // linked from the vendor repo's v5 migration docs
/** v5 `list` accepts a `limit` of at most 100. */
const LIST_PAGE_MAX = 100;
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 10;
const NAMESPACE_PAGE_SIZE = 100;
const RELATED_LIMIT = 20;

const SUPERMEMORY_CAPABILITIES: MemoryCapabilities = {
	add: true,
	search: true,
	get: true,
	list: true,
	update: false,
	delete: true,
	feedback: false,
};

/**
 * Every route needs the namespace, so it travels in the id. Memories are
 * `<ns>:<memoryId>`; the document `add` stores is `<ns>:document:<docId>`
 * because documents and memories are different resources with different routes.
 */
const DOCUMENT_PREFIX = "document:";

function encodeMemoryRef(namespace: string, memoryId: string): string {
	return `${encodeURIComponent(namespace)}:${memoryId}`;
}

function parseMemoryRef(
	id: string
): { namespace: string; memoryId: string; document: boolean } | null {
	const trimmed = id.trim();
	const colon = trimmed.indexOf(":");
	if (colon <= 0) return null;
	let memoryId = trimmed.slice(colon + 1).trim();
	const document = memoryId.startsWith(DOCUMENT_PREFIX);
	if (document) memoryId = memoryId.slice(DOCUMENT_PREFIX.length).trim();
	if (!memoryId) return null;
	try {
		return { namespace: decodeURIComponent(trimmed.slice(0, colon)), memoryId, document };
	} catch {
		return null;
	}
}

function nsPath(namespace: string, route: string): string {
	return `ns/${encodeURIComponent(namespace)}/${route}`;
}

function requireNamespace(scope: { userId?: string }): string {
	const namespace = scope.userId?.trim();
	if (!namespace) throw new Error(getMessage().MEMORY_CONNECTOR_FILTER_REQUIRED);
	return namespace;
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** `add` metadata values are strings, numbers, booleans, or string lists only. */
function writableMetadata(
	metadata: Record<string, unknown> | undefined
): Record<string, string | number | boolean | string[]> | undefined {
	if (!metadata) return undefined;
	const kept: Record<string, string | number | boolean | string[]> = {};
	for (const [key, value] of Object.entries(metadata)) {
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean" ||
			(Array.isArray(value) && value.every((item) => typeof item === "string"))
		) {
			kept[key] = value as string | number | boolean | string[];
		}
	}
	return Object.keys(kept).length ? kept : undefined;
}

function normalizeHistory(raw: unknown): MemoryHistoryEvent[] {
	const included = asRecord(asRecord(raw).included);
	const parents = asRecord(included.related).parents;
	if (!Array.isArray(parents)) return [];
	const events: MemoryHistoryEvent[] = [];
	for (const item of parents) {
		const row = asRecord(item);
		const oldMemory = stringValue(row.memory);
		if (!oldMemory) continue;
		events.push({
			id: stringValue(row.id),
			event: (stringValue(row.relation) || "updates").toUpperCase(),
			oldMemory,
			createdAt: stringValue(asRecord(row.system).updatedAt),
		});
	}
	return events;
}

/**
 * A memory arrives from `list` and `get` (`memory`, `system.createdAt`) or as a
 * search hit (`memory` or a source `chunk`, `similarity`). Only a hit has a
 * score.
 */
function normalizeRecord(
	raw: unknown,
	namespace: string,
	extras: { history?: MemoryHistoryEvent[] } = {}
): MemoryRecord | null {
	const row = asRecord(raw);
	const id = stringValue(row.id);
	const content = stringValue(row.memory) || stringValue(row.chunk) || "";
	if (!id || !content) return null;
	const system = asRecord(row.system);
	const forgotten = booleanValue(row.isForgotten) === true;
	const version = numberValue(row.version);
	const flags = {
		...(version !== undefined ? { version } : {}),
		...(booleanValue(row.isStatic) !== undefined ? { is_static: row.isStatic } : {}),
		...(booleanValue(row.isInference) !== undefined ? { is_inference: row.isInference } : {}),
		...(booleanValue(row.isLatest) !== undefined ? { is_latest: row.isLatest } : {}),
		...(typeof row.chunk === "string" && !row.memory ? { source: "chunk" } : {}),
	};
	return {
		id: encodeMemoryRef(namespace, id),
		content,
		userId: namespace,
		metadata: { ...asRecord(row.metadata), supermemory: flags },
		history: extras.history?.length ? extras.history : undefined,
		score: numberValue(row.similarity),
		createdAt: stringValue(system.createdAt),
		updatedAt: stringValue(system.updatedAt),
		lifecycleState: forgotten ? "forgotten" : undefined,
	};
}

function normalizeRecords(rows: unknown[], namespace: string): MemoryRecord[] {
	return rows
		.map((row) => normalizeRecord(row, namespace))
		.filter((row): row is MemoryRecord => !!row);
}

export class SupermemoryAdapter extends BaseMemoryAdapter {
	readonly type = "supermemory";

	private get baseUrl(): string {
		return memoryBaseUrl(this.descriptor, DEFAULT_URL);
	}

	private request<T>(
		path: string,
		opts: { method?: string; body?: unknown; timeoutMs?: number; retry?: boolean } = {}
	) {
		return memoryRequest<T>(this.descriptor, this.baseUrl, path, {
			...opts,
			authHeaders: (secret: ResolvedSecret): Record<string, string> => {
				const apiKey = secret.credentials.apiKey || secret.raw;
				return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
			},
		});
	}

	capabilities(): MemoryCapabilities {
		return { ...SUPERMEMORY_CAPABILITIES };
	}

	/** Listing namespaces needs a valid key and writes nothing. */
	async healthCheck(): Promise<ConnectorHealthResult> {
		const started = Date.now();
		try {
			await this.request("namespaces?page=1&limit=1", { timeoutMs: 10_000 });
			return { ok: true, latencyMs: Date.now() - started };
		} catch (error) {
			const status = error instanceof SourceResponseError ? error.status : undefined;
			return {
				ok: false,
				latencyMs: Date.now() - started,
				message:
					status === 401 || status === 403
						? getMessage().MEMORY_CONNECTOR_SUPERMEMORY_AUTH_FAILED
						: String((error as Error)?.message || error),
			};
		}
	}

	async listFilters(): Promise<MemoryFilterOptions> {
		const filters = emptyMemoryFilters();
		try {
			const body = requireObject(
				await this.request(`namespaces?page=1&limit=${NAMESPACE_PAGE_SIZE}`),
				getMessage().MEMORY_CONNECTOR_BAD_RESPONSE
			);
			filters.users = uniqueChoices(
				requireArray(body.namespaces, getMessage().MEMORY_CONNECTOR_BAD_RESPONSE)
					.map((item) => stringValue(asRecord(item).namespace))
					.filter((namespace): namespace is string => !!namespace)
					.map((namespace) => ({ id: namespace, label: namespace }))
			);
		} catch {
			filters.users = [];
		}
		return filters;
	}

	async add(input: MemoryWriteInput): Promise<MemoryRecord[]> {
		const messages = getMessage();
		const content = writeContent(input);
		if (!content) throw new Error(messages.MEMORY_CONNECTOR_CONTENT_REQUIRED);
		const namespace = requireNamespace(input);
		const metadata = writableMetadata(input.metadata);
		const result = requireObject(
			await this.request(nsPath(namespace, "document"), {
				method: "POST",
				body: { content, ...(metadata ? { metadata } : {}) },
				retry: false,
			}),
			messages.MEMORY_CONNECTOR_BAD_RESPONSE
		);
		const documentId = stringValue(result.id);
		if (!documentId) throw new Error(messages.MEMORY_CONNECTOR_BAD_RESPONSE);
		const status = stringValue(result.status) || "queued";
		if (status === "failed") {
			throw new Error(messages.MEMORY_CONNECTOR_SUPERMEMORY_ADD_FAILED);
		}
		// What was stored is a document; its memories are extracted asynchronously.
		// The id is namespaced and marked as a document so get/delete use the
		// document routes instead of 404-ing on the memory routes.
		return [
			{
				id: encodeMemoryRef(namespace, `${DOCUMENT_PREFIX}${documentId}`),
				content,
				userId: namespace,
				metadata: {
					...metadata,
					supermemory: { kind: "document", status },
				},
			},
		];
	}

	async search(query: MemorySearchQuery): Promise<MemoryRecord[]> {
		const messages = getMessage();
		const q = query.query.trim();
		if (!q) throw new Error(messages.MEMORY_CONNECTOR_QUERY_REQUIRED);
		const namespace = requireNamespace(query);
		const limit = query.limit || DEFAULT_SEARCH_LIMIT;
		const body = requireObject(
			await this.request(nsPath(namespace, "search"), {
				method: "POST",
				body: {
					query: q,
					searchMode: "memories",
					limit,
					...(typeof query.threshold === "number"
						? { threshold: query.threshold }
						: {}),
				},
			}),
			messages.MEMORY_CONNECTOR_BAD_RESPONSE
		);
		return normalizeRecords(
			requireArray(body.results, messages.MEMORY_CONNECTOR_BAD_RESPONSE),
			namespace
		).slice(0, limit);
	}

	async listPage(filter: MemoryListFilter): Promise<MemoryListPage> {
		const messages = getMessage();
		const namespace = requireNamespace(filter);
		const limit = Math.min(
			LIST_PAGE_MAX,
			Math.max(1, Math.floor(filter.limit || DEFAULT_LIST_LIMIT))
		);
		const offset = Math.max(0, Math.floor(filter.offset || 0));
		// Pages are 1-based and fixed-size; an offset between two pages reads the
		// page it falls in and drops the rows before it.
		const page = Math.floor(offset / limit) + 1;
		const params = new URLSearchParams({
			page: String(page),
			limit: String(limit),
			sort: "createdAt",
			order: "desc",
		});
		const body = requireObject(
			await this.request(nsPath(namespace, `list/memories?${params.toString()}`), {
				method: "POST",
				body: {},
			}),
			messages.MEMORY_CONNECTOR_BAD_RESPONSE
		);
		const rows = requireArray(body.memories, messages.MEMORY_CONNECTOR_BAD_RESPONSE);
		const pagination = asRecord(body.pagination);
		const total = numberValue(pagination.totalItems);
		const pageStart = (page - 1) * limit;
		const records = normalizeRecords(rows, namespace).slice(offset - pageStart);
		const nextOffset = pageStart + rows.length;
		return {
			records,
			total,
			hasMore:
				booleanValue(pagination.hasMore) ??
				(numberValue(pagination.currentPage) ?? page) <
					(numberValue(pagination.totalPages) ?? 0),
			nextOffset,
		};
	}

	async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
		return (await this.listPage(filter)).records;
	}

	async get(id: string): Promise<MemoryRecord | null> {
		const ref = parseMemoryRef(id);
		if (!ref) return null;
		const params = new URLSearchParams({
			include: "related",
			relatedLimit: String(RELATED_LIMIT),
		});
		if (ref.document) return this.getDocument(ref.namespace, ref.memoryId);
		let body: unknown;
		try {
			body = await this.request(
				nsPath(ref.namespace, `memories/${encodeURIComponent(ref.memoryId)}?${params.toString()}`)
			);
		} catch (error) {
			// A memory from another namespace is a 404 too.
			if (error instanceof SourceResponseError && error.status === 404) return null;
			throw error;
		}
		const row = requireObject(body, getMessage().MEMORY_CONNECTOR_BAD_RESPONSE);
		return normalizeRecord(row, ref.namespace, { history: normalizeHistory(row) });
	}

	private async getDocument(namespace: string, documentId: string): Promise<MemoryRecord | null> {
		let body: unknown;
		try {
			body = await this.request(
				nsPath(namespace, `document/${encodeURIComponent(documentId)}`)
			);
		} catch (error) {
			if (error instanceof SourceResponseError && error.status === 404) return null;
			throw error;
		}
		const row = requireObject(body, getMessage().MEMORY_CONNECTOR_BAD_RESPONSE);
		const system = asRecord(row.system);
		const status = stringValue(system.status);
		const content = stringValue(row.content) || stringValue(row.summary) || stringValue(row.title);
		if (!content) return null;
		return {
			id: encodeMemoryRef(namespace, `${DOCUMENT_PREFIX}${documentId}`),
			content,
			userId: namespace,
			metadata: {
				...asRecord(row.metadata),
				supermemory: { kind: "document", ...(status ? { status } : {}) },
			},
			createdAt: stringValue(system.createdAt),
			updatedAt: stringValue(system.updatedAt),
		};
	}

	async delete(id: string): Promise<void> {
		const messages = getMessage();
		const ref = parseMemoryRef(id);
		if (!ref) throw new Error(messages.MEMORY_DETAIL_NOT_FOUND);
		const result = requireObject(
			await this.request(nsPath(ref.namespace, ref.document ? "document" : "memories"), {
				method: "DELETE",
				body: { ids: [ref.memoryId] },
				retry: false,
			}),
			messages.MEMORY_CONNECTOR_BAD_RESPONSE
		);
		// HTTP success can still carry a per-id failure (missing or already forgotten).
		const errors = Array.isArray(result.errors) ? result.errors : [];
		if (errors.length || !numberValue(result.count)) {
			throw new Error(
				stringValue(asRecord(errors[0]).error) || messages.MEMORY_DETAIL_NOT_FOUND
			);
		}
	}
}

export const supermemoryAdapterFactory = {
	type: "supermemory",
	create: (descriptor: MemorySourceDescriptor) => new SupermemoryAdapter(descriptor),
	describe: (): MemoryTypeDescriptor => {
		const messages = getMessage();
		return {
			type: "supermemory",
			displayName: "Supermemory",
			description: messages.MEMORY_CONNECTOR_SUPERMEMORY_DESCRIPTION,
			capabilities: { ...SUPERMEMORY_CAPABILITIES },
			configFields: memoryHttpVendorFields({ placeholder: DEFAULT_URL }),
			filterFields: memoryPageFilters([
				{
					key: "userId",
					label: messages.MEMORY_CONNECTOR_FIELD_SUPERMEMORY_NAMESPACE,
					required: true,
				},
			]),
			authStyle: "api-key",
			authHelp: messages.MEMORY_CONNECTOR_AUTH_HELP_SUPERMEMORY,
			docsUrl: DOCS_URL,
		};
	},
};
