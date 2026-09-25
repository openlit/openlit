/**
 * LangGraph memory connector.
 *
 * Talks to the Store API of a LangGraph Server (LangGraph Platform / LangSmith
 * deployments or a self-hosted server). Both expose the same `/store/*` routes;
 * only authentication differs. The API key is optional and, when set, is sent
 * as `x-api-key`. Bearer and other custom auth handlers are not supported.
 *
 * Store items are addressed by a namespace (ordered string labels) plus a key.
 * Namespace segments carry no user/thread/assistant meaning unless the optional
 * namespace template declares it (for example `memories/{user_id}`). Without
 * placeholders, full namespaces are exposed through the session filter, the
 * same way the Claude connector exposes memory stores.
 *
 * Item values are arbitrary JSON. Content is read from the LangMem shapes
 * (`{kind, content: {content}}` or `{content}`) and otherwise falls back to the
 * JSON of the whole value; the original value is always kept in metadata.
 *
 * Search is semantic only when the server has a store index configured.
 * Without one LangGraph ignores the query, returns items in listing order, and
 * scores are null. OpenLIT does not emulate semantic search locally.
 */

import { randomUUID } from "crypto";
import getMessage from "@/constants/messages";
import type { ConnectorHealthResult } from "../../types";
import {
	allowHttpField,
	allowPrivateNetworkField,
	endpointField,
} from "../../datasource/config-fields";
import { SourceResponseError } from "../../datasource/http/safe-fetch";
import type { ResolvedSecret } from "../../datasource/http/secret";
import { BaseMemoryAdapter } from "../base-adapter";
import { memoryApiKeyField, memoryPageFilters } from "../config-fields";
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
	MemoryUpdateInput,
	MemoryWriteInput,
} from "../types";
import { emptyMemoryFilters } from "../types";

const DOCS_URL = "https://docs.langchain.com/langsmith/agent-server";
const URL_PLACEHOLDER = "http://localhost:2024";
const DEFAULT_LIMIT = 25;
const NAMESPACE_PAGE_SIZE = 100;
const MAX_NAMESPACE_PAGES = 5;
/** Upper bound on namespaces searched when a template prefix has a gap. */
const MAX_CANDIDATE_NAMESPACES = 10;

const LANGGRAPH_CAPABILITIES: MemoryCapabilities = {
	add: true,
	search: true,
	get: true,
	list: true,
	update: true,
	delete: true,
	feedback: false,
};

type Placeholder = "user_id" | "thread_id" | "assistant_id";
type RecordField = "userId" | "sessionId" | "agentId";

const PLACEHOLDER_FIELDS: Record<Placeholder, RecordField> = {
	user_id: "userId",
	thread_id: "sessionId",
	assistant_id: "agentId",
};

type TemplateSegment =
	| { kind: "fixed"; value: string }
	| { kind: "placeholder"; name: Placeholder };

interface NamespaceScope {
	/** Fixed and placeholder segments, or null when no template is configured. */
	template: TemplateSegment[] | null;
	/** True when the template declares at least one placeholder. */
	mapped: boolean;
	/** Leading fixed segments, used as the discovery/listing prefix. */
	prefix: string[];
}

interface StoreItem {
	namespace: string[];
	key: string;
	/** The Store contract types values as objects (`dict[str, Any]`); PUT rejects anything else. */
	value: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
	score?: number;
}

type ContentSource = "nested" | "content" | "fallback";

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function isValidLabel(label: string): boolean {
	return label.length > 0 && !label.includes(".");
}

/** LangGraph rejects empty labels and labels containing "." (GET joins with "."). */
function assertNamespace(namespace: string[]): string[] {
	if (!namespace.length || !namespace.every(isValidLabel)) {
		throw new Error(getMessage().MEMORY_CONNECTOR_LANGGRAPH_INVALID_NAMESPACE);
	}
	return namespace;
}

function namespaceId(namespace: string[]): string {
	return namespace.join(".");
}

function parseNamespaceId(value: string): string[] {
	return assertNamespace(value.split(".").map((label) => label.trim()));
}

/**
 * Memory ids are `<namespace joined by ".">:<URI-encoded key>`. Labels may
 * contain ":" but the encoded key never does, so the last ":" splits the id.
 */
function encodeMemoryRef(namespace: string[], key: string): string {
	return `${namespaceId(namespace)}:${encodeURIComponent(key)}`;
}

function parseMemoryRef(id: string): { namespace: string[]; key: string } | null {
	const trimmed = id.trim();
	const split = trimmed.lastIndexOf(":");
	if (split <= 0) return null;
	const namespace = trimmed.slice(0, split).split(".");
	if (!namespace.every(isValidLabel)) return null;
	let key: string;
	try {
		key = decodeURIComponent(trimmed.slice(split + 1));
	} catch {
		return null;
	}
	return key ? { namespace, key } : null;
}

function parseTemplate(raw: unknown): TemplateSegment[] | null {
	if (typeof raw !== "string" || !raw.trim()) return null;
	const segments = raw
		.split("/")
		.map((part) => part.trim())
		.filter(Boolean);
	const seen = new Set<Placeholder>();
	const parsed: TemplateSegment[] = [];
	for (const segment of segments) {
		const match = /^\{([a-z_]+)\}$/.exec(segment);
		if (match) {
			const name = match[1] as Placeholder;
			if (!(name in PLACEHOLDER_FIELDS) || seen.has(name)) {
				throw new Error(getMessage().MEMORY_CONNECTOR_LANGGRAPH_INVALID_TEMPLATE);
			}
			seen.add(name);
			parsed.push({ kind: "placeholder", name });
			continue;
		}
		if (!isValidLabel(segment) || /[{}]/.test(segment)) {
			throw new Error(getMessage().MEMORY_CONNECTOR_LANGGRAPH_INVALID_TEMPLATE);
		}
		parsed.push({ kind: "fixed", value: segment });
	}
	return parsed.length ? parsed : null;
}

function leadingFixed(template: TemplateSegment[] | null): string[] {
	const prefix: string[] = [];
	for (const segment of template || []) {
		if (segment.kind !== "fixed") break;
		prefix.push(segment.value);
	}
	return prefix;
}

function startsWith(namespace: string[], prefix: string[]): boolean {
	return prefix.every((label, index) => namespace[index] === label);
}

/** Placeholder values an item's namespace provides, or null when it does not fit the template. */
function matchTemplate(
	template: TemplateSegment[],
	namespace: string[]
): Partial<Record<RecordField, string>> | null {
	if (namespace.length < template.length) return null;
	const fields: Partial<Record<RecordField, string>> = {};
	for (let index = 0; index < template.length; index += 1) {
		const segment = template[index];
		if (segment.kind === "fixed") {
			if (namespace[index] !== segment.value) return null;
		} else {
			fields[PLACEHOLDER_FIELDS[segment.name]] = namespace[index];
		}
	}
	return fields;
}

/** Whether a namespace falls inside the connector's configured template or prefix. */
function namespaceInScope(scope: NamespaceScope, namespace: string[]): boolean {
	return scope.mapped && scope.template
		? !!matchTemplate(scope.template, namespace)
		: startsWith(namespace, scope.prefix);
}

function filterValue(
	filter: { userId?: string; sessionId?: string; agentId?: string },
	field: RecordField
): string | undefined {
	return stringValue(filter[field]);
}

/**
 * Where OpenLIT's content came from in a Store value:
 * 1. LangMem `MemoryStoreManager` shape: `value.content.content`
 * 2. LangMem memory tools shape: string `value.content`
 * 3. fallback: JSON of the whole value
 */
function contentSource(value: Record<string, unknown>): ContentSource {
	if (isPlainObject(value.content) && typeof value.content.content === "string") {
		return "nested";
	}
	if (typeof value.content === "string") return "content";
	return "fallback";
}

function readContent(value: Record<string, unknown>): string {
	const source = contentSource(value);
	if (source === "nested") return asRecord(value.content).content as string;
	if (source === "content") return value.content as string;
	return JSON.stringify(value);
}

/**
 * Rebuilds a value with new content, touching only the field the content was
 * read from. Throws instead of overwriting when a JSON-fallback value already
 * has a non-text `content` field.
 */
function replaceContent(
	value: Record<string, unknown>,
	content: string
): Record<string, unknown> {
	const source = contentSource(value);
	if (source === "nested") {
		return { ...value, content: { ...asRecord(value.content), content } };
	}
	if (source === "fallback" && Object.prototype.hasOwnProperty.call(value, "content")) {
		throw new Error(getMessage().MEMORY_CONNECTOR_LANGGRAPH_UPDATE_CONFLICT);
	}
	return { ...value, content };
}

/** `langgraph` is OpenLIT's read-only projection of the item; never write it back. */
function writableMetadata(
	metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
	if (!metadata) return undefined;
	const { langgraph: _projection, ...rest } = metadata;
	return Object.keys(rest).length ? rest : undefined;
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

function normalizeItem(raw: unknown): StoreItem | null {
	const row = asRecord(raw);
	const key = typeof row.key === "string" ? row.key : "";
	const namespace = Array.isArray(row.namespace)
		? row.namespace.filter((label): label is string => typeof label === "string")
		: [];
	if (!key || !namespace.length) return null;
	return {
		namespace,
		key,
		value: asRecord(row.value),
		createdAt: stringValue(row.created_at),
		updatedAt: stringValue(row.updated_at),
		score:
			typeof row.score === "number" && Number.isFinite(row.score)
				? row.score
				: undefined,
	};
}

function normalizeItems(raw: unknown): StoreItem[] {
	const rows = asRecord(raw).items;
	if (!Array.isArray(rows)) return [];
	return rows
		.map((row) => normalizeItem(row))
		.filter((item): item is StoreItem => !!item);
}

/** Documented as a bare array; the server returns `{ namespaces }`. Accept both. */
function normalizeNamespaces(raw: unknown): string[][] {
	const rows = Array.isArray(raw) ? raw : asRecord(raw).namespaces;
	if (!Array.isArray(rows)) return [];
	return rows
		.filter((row): row is unknown[] => Array.isArray(row))
		.map((row) => row.filter((label): label is string => typeof label === "string"))
		.filter((row) => row.length > 0 && row.every(isValidLabel));
}

function sortMerged(items: StoreItem[]): StoreItem[] {
	return [...items].sort((a, b) => {
		const scoreA = a.score ?? Number.NEGATIVE_INFINITY;
		const scoreB = b.score ?? Number.NEGATIVE_INFINITY;
		if (scoreA !== scoreB) return scoreB - scoreA;
		return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
	});
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

export class LangGraphAdapter extends BaseMemoryAdapter {
	readonly type = "langgraph";

	private get baseUrl(): string {
		const url = memoryBaseUrl(this.descriptor, "");
		if (!url) throw new Error(getMessage().MEMORY_CONNECTOR_LANGGRAPH_URL_REQUIRED);
		return url;
	}

	private scope(): NamespaceScope {
		const template = parseTemplate(this.descriptor.settings.namespaceTemplate);
		return {
			template,
			mapped: !!template?.some((segment) => segment.kind === "placeholder"),
			prefix: leadingFixed(template),
		};
	}

	private request<T>(
		path: string,
		opts: { method?: string; body?: unknown; timeoutMs?: number } = {}
	) {
		return memoryRequest<T>(this.descriptor, this.baseUrl, path, {
			...opts,
			authHeaders: (secret: ResolvedSecret): Record<string, string> => {
				const apiKey = secret.credentials.apiKey || secret.raw;
				return apiKey ? { "x-api-key": apiKey } : {};
			},
		});
	}

	capabilities(): MemoryCapabilities {
		return { ...LANGGRAPH_CAPABILITIES };
	}

	/** `/ok` and `/info` skip auth, so probe an authenticated store route instead. */
	async healthCheck(): Promise<ConnectorHealthResult> {
		const started = Date.now();
		try {
			this.scope();
			await this.request("store/namespaces", {
				method: "POST",
				body: { limit: 1 },
				timeoutMs: 10_000,
			});
			return { ok: true, latencyMs: Date.now() - started };
		} catch (error) {
			const messages = getMessage();
			const status = error instanceof SourceResponseError ? error.status : undefined;
			return {
				ok: false,
				latencyMs: Date.now() - started,
				message:
					status === 401 || status === 403
						? messages.MEMORY_CONNECTOR_LANGGRAPH_AUTH_FAILED
						: status === 404
							? messages.MEMORY_CONNECTOR_LANGGRAPH_STORE_NOT_FOUND
							: String((error as Error)?.message || error),
			};
		}
	}

	async add(input: MemoryWriteInput): Promise<MemoryRecord[]> {
		const content = writeContent(input);
		if (!content) throw new Error(getMessage().MEMORY_CONNECTOR_CONTENT_REQUIRED);
		const namespace = this.writeNamespace(input);
		const key = randomUUID();
		const metadata = writableMetadata(input.metadata);
		const value: Record<string, unknown> = {
			content,
			...(metadata ? { metadata } : {}),
		};
		await this.request("store/items", {
			method: "PUT",
			body: { namespace, key, value },
		});
		return [this.toRecord({ namespace, key, value })];
	}

	async search(query: MemorySearchQuery): Promise<MemoryRecord[]> {
		const q = query.query.trim();
		if (!q) throw new Error(getMessage().MEMORY_CONNECTOR_QUERY_REQUIRED);
		return this.find(query, q);
	}

	async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
		return this.find(filter);
	}

	async get(id: string): Promise<MemoryRecord | null> {
		const ref = this.scopedRef(id);
		if (!ref) return null;
		const item = await this.fetchItem(ref.namespace, ref.key);
		return item ? this.toRecord(item) : null;
	}

	/**
	 * Store PUT replaces the whole value, so update is read-modify-write: read
	 * the item, replace only the field the content came from, keep every other
	 * field, and PUT the result. The Store API offers no compare-and-swap, so a
	 * write landing between the read and the PUT can be lost.
	 */
	async update(id: string, input: MemoryUpdateInput): Promise<MemoryRecord> {
		const messages = getMessage();
		const ref = this.scopedRef(id);
		if (!ref) throw new Error(messages.MEMORY_DETAIL_NOT_FOUND);
		const existing = await this.fetchItem(ref.namespace, ref.key);
		if (!existing) throw new Error(messages.MEMORY_DETAIL_NOT_FOUND);

		let value = replaceContent(existing.value, input.content);
		const metadata = writableMetadata(input.metadata);
		if (metadata) {
			const current = existing.value.metadata;
			if (current !== undefined && !isPlainObject(current)) {
				throw new Error(messages.MEMORY_CONNECTOR_LANGGRAPH_UPDATE_CONFLICT);
			}
			value = { ...value, metadata: { ...asRecord(current), ...metadata } };
		}

		await this.request("store/items", {
			method: "PUT",
			body: { namespace: ref.namespace, key: ref.key, value },
		});
		return this.toRecord({ ...existing, value, updatedAt: undefined });
	}

	async delete(id: string): Promise<void> {
		const ref = this.scopedRef(id);
		if (!ref) throw new Error(getMessage().MEMORY_DETAIL_NOT_FOUND);
		await this.request("store/items", {
			method: "DELETE",
			body: { namespace: ref.namespace, key: ref.key },
		});
	}

	async listFilters(): Promise<MemoryFilterOptions> {
		try {
			const scope = this.scope();
			const namespaces = await this.listNamespaces(
				scope.prefix,
				scope.mapped ? scope.template?.length : undefined
			);
			const filters = emptyMemoryFilters();
			if (!scope.mapped || !scope.template) {
				filters.sessions = uniqueChoices(
					namespaces.map((namespace) => ({
						id: namespaceId(namespace),
						label: namespaceId(namespace),
					}))
				);
				return filters;
			}
			for (const namespace of namespaces) {
				const fields = matchTemplate(scope.template, namespace);
				if (!fields) continue;
				if (fields.userId) {
					filters.users.push({ id: fields.userId, label: fields.userId });
				}
				if (fields.sessionId) {
					filters.sessions.push({
						id: fields.sessionId,
						label: fields.sessionId,
						...(fields.userId ? { userId: fields.userId } : {}),
					});
				}
				if (fields.agentId) {
					filters.agents.push({ id: fields.agentId, label: fields.agentId });
				}
			}
			return {
				users: uniqueChoices(filters.users),
				sessions: uniqueChoices(filters.sessions),
				agents: uniqueChoices(filters.agents),
			};
		} catch {
			return emptyMemoryFilters();
		}
	}

	/**
	 * Parses a memory id and rejects namespaces outside this connector's scope
	 * before any request, so a crafted id cannot reach other namespaces and
	 * out-of-scope items look the same as missing ones.
	 */
	private scopedRef(id: string): { namespace: string[]; key: string } | null {
		const ref = parseMemoryRef(id);
		return ref && namespaceInScope(this.scope(), ref.namespace) ? ref : null;
	}

	private async fetchItem(namespace: string[], key: string): Promise<StoreItem | null> {
		const params = new URLSearchParams();
		params.set("namespace", namespaceId(assertNamespace(namespace)));
		params.set("key", key);
		const body = await this.request(`store/items?${params.toString()}`);
		return normalizeItem(body);
	}

	private writeNamespace(input: MemoryWriteInput): string[] {
		const messages = getMessage();
		const scope = this.scope();
		if (!scope.mapped || !scope.template) {
			const selected = stringValue(input.sessionId);
			if (!selected) throw new Error(messages.MEMORY_CONNECTOR_SESSION_REQUIRED);
			const namespace = parseNamespaceId(selected);
			if (!startsWith(namespace, scope.prefix)) {
				throw new Error(messages.MEMORY_CONNECTOR_LANGGRAPH_INVALID_NAMESPACE);
			}
			return namespace;
		}
		const missing: string[] = [];
		const namespace = scope.template.map((segment) => {
			if (segment.kind === "fixed") return segment.value;
			const value = filterValue(input, PLACEHOLDER_FIELDS[segment.name]);
			if (!value) missing.push(segment.name);
			return value || "";
		});
		if (missing.length) {
			throw new Error(messages.MEMORY_CONNECTOR_LANGGRAPH_TEMPLATE_VALUES_REQUIRED(missing.join(", ")));
		}
		return assertNamespace(namespace);
	}

	/** Shared list/search path: resolve namespace prefixes, query, and keep matching items. */
	private async find(
		filter: MemoryListFilter,
		query?: string
	): Promise<MemoryRecord[]> {
		const scope = this.scope();
		const limit = filter.limit || DEFAULT_LIMIT;
		const prefixes = await this.searchPrefixes(scope, filter);
		if (!prefixes.length) return [];

		const batches = await Promise.all(
			prefixes.map((prefix) => this.searchItems(prefix, limit, query))
		);
		const items = batches.flat().filter((item) => this.matches(scope, filter, item));
		const ordered = prefixes.length > 1 ? sortMerged(items) : items;
		return ordered.slice(0, limit).map((item) => this.toRecord(item, scope));
	}

	/**
	 * Namespace prefixes to search. The Store only matches prefixes, so a
	 * template whose supplied values leave a gap (e.g. thread without user)
	 * resolves candidate namespaces through `/store/namespaces` first.
	 * Returns [] when a filter can never match in this connector's mode.
	 */
	private async searchPrefixes(
		scope: NamespaceScope,
		filter: MemoryListFilter
	): Promise<string[][]> {
		if (!scope.mapped || !scope.template) {
			if (filterValue(filter, "userId") || filterValue(filter, "agentId")) return [];
			const selected = filterValue(filter, "sessionId");
			if (!selected) return [scope.prefix];
			const namespace = parseNamespaceId(selected);
			return startsWith(namespace, scope.prefix) ? [namespace] : [];
		}

		const template = scope.template;
		const declared = new Set<RecordField>();
		for (const segment of template) {
			if (segment.kind === "placeholder") declared.add(PLACEHOLDER_FIELDS[segment.name]);
		}
		const fields: RecordField[] = ["userId", "sessionId", "agentId"];
		if (fields.some((field) => filterValue(filter, field) && !declared.has(field))) {
			return [];
		}

		const values = template.map((segment) =>
			segment.kind === "fixed"
				? segment.value
				: filterValue(filter, PLACEHOLDER_FIELDS[segment.name])
		);
		values.forEach((value) => {
			if (value !== undefined && !isValidLabel(value)) {
				throw new Error(getMessage().MEMORY_CONNECTOR_LANGGRAPH_INVALID_NAMESPACE);
			}
		});
		const gap = values.findIndex((value) => value === undefined);
		const prefix = (gap === -1 ? values : values.slice(0, gap)) as string[];
		let lastDefined = -1;
		values.forEach((value, index) => {
			if (value !== undefined) lastDefined = index;
		});
		if (lastDefined < prefix.length) return [prefix];

		const depth = lastDefined + 1;
		const candidates = await this.listNamespaces(prefix, depth);
		const seen = new Set<string>();
		const resolved: string[][] = [];
		for (const namespace of candidates) {
			if (namespace.length < depth) continue;
			const truncated = namespace.slice(0, depth);
			const fits = values
				.slice(0, depth)
				.every((value, index) => value === undefined || truncated[index] === value);
			if (!fits) continue;
			const id = namespaceId(truncated);
			if (seen.has(id)) continue;
			seen.add(id);
			resolved.push(truncated);
			if (resolved.length >= MAX_CANDIDATE_NAMESPACES) break;
		}
		return resolved;
	}

	private matches(
		scope: NamespaceScope,
		filter: MemoryListFilter,
		item: StoreItem
	): boolean {
		if (!scope.mapped || !scope.template) {
			if (!startsWith(item.namespace, scope.prefix)) return false;
			const selected = filterValue(filter, "sessionId");
			return !selected || namespaceId(item.namespace) === selected;
		}
		const fields = matchTemplate(scope.template, item.namespace);
		if (!fields) return false;
		return (["userId", "sessionId", "agentId"] as RecordField[]).every((field) => {
			const wanted = filterValue(filter, field);
			return !wanted || fields[field] === wanted;
		});
	}

	private async searchItems(
		prefix: string[],
		limit: number,
		query?: string
	): Promise<StoreItem[]> {
		const body = await this.request("store/items/search", {
			method: "POST",
			body: {
				namespace_prefix: prefix,
				limit,
				offset: 0,
				...(query ? { query } : {}),
			},
		});
		return normalizeItems(body);
	}

	private async listNamespaces(prefix: string[], maxDepth?: number): Promise<string[][]> {
		const namespaces: string[][] = [];
		for (let page = 0; page < MAX_NAMESPACE_PAGES; page += 1) {
			const body = await this.request("store/namespaces", {
				method: "POST",
				body: {
					...(prefix.length ? { prefix } : {}),
					...(maxDepth ? { max_depth: maxDepth } : {}),
					limit: NAMESPACE_PAGE_SIZE,
					offset: page * NAMESPACE_PAGE_SIZE,
				},
			});
			const rows = normalizeNamespaces(body);
			namespaces.push(...rows);
			if (rows.length < NAMESPACE_PAGE_SIZE) break;
		}
		return namespaces;
	}

	private toRecord(item: StoreItem, scope: NamespaceScope = this.scope()): MemoryRecord {
		const fields =
			scope.mapped && scope.template
				? matchTemplate(scope.template, item.namespace) || {}
				: { sessionId: namespaceId(item.namespace) };
		const ownMetadata = isPlainObject(item.value.metadata) ? item.value.metadata : {};
		return {
			id: encodeMemoryRef(item.namespace, item.key),
			content: readContent(item.value),
			...fields,
			metadata: {
				...ownMetadata,
				langgraph: {
					namespace: item.namespace,
					key: item.key,
					value: item.value,
				},
			},
			score: item.score,
			createdAt: item.createdAt,
			updatedAt: item.updatedAt,
		};
	}
}

export const langgraphAdapterFactory = {
	type: "langgraph",
	create: (descriptor: MemorySourceDescriptor) => new LangGraphAdapter(descriptor),
	describe: (): MemoryTypeDescriptor => {
		const messages = getMessage();
		return {
			type: "langgraph",
			displayName: "LangGraph",
			description: messages.MEMORY_CONNECTOR_LANGGRAPH_DESCRIPTION,
			capabilities: { ...LANGGRAPH_CAPABILITIES },
			configFields: [
				endpointField(URL_PLACEHOLDER),
				allowHttpField(),
				allowPrivateNetworkField(),
				{
					...memoryApiKeyField(),
					description: messages.MEMORY_CONNECTOR_LANGGRAPH_API_KEY_HELP,
				},
				{
					key: "namespaceTemplate",
					label: messages.MEMORY_CONNECTOR_FIELD_NAMESPACE_TEMPLATE,
					kind: "text",
					group: "settings",
					placeholder: "memories/{user_id}",
					description: messages.MEMORY_CONNECTOR_FIELD_NAMESPACE_TEMPLATE_HELP,
				},
			],
			filterFields: memoryPageFilters([
				"userId",
				{
					key: "sessionId",
					label: messages.MEMORY_CONNECTOR_FIELD_NAMESPACE_OR_THREAD,
				},
				"agentId",
			]),
			authStyle: "api-key",
			authHelp: messages.MEMORY_CONNECTOR_AUTH_HELP_LANGGRAPH,
			docsUrl: DOCS_URL,
		};
	},
};
