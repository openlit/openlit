/**
 * Zep memory connector.
 *
 * Talks to the Zep Cloud REST API (hosted `https://api.getzep.com` or a
 * self-hosted compatible endpoint). User graph facts, session memory, search,
 * and per-fact get are supported. Delete targets graph edges/nodes, not the
 * whole session.
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
	MemoryHistoryEvent,
	MemoryListFilter,
	MemoryMessage,
	MemoryRecord,
	MemorySearchQuery,
	MemorySourceDescriptor,
	MemoryTypeDescriptor,
	MemoryWriteInput,
} from "../types";
import { emptyMemoryFilters } from "../types";

const DEFAULT_URL = "https://api.getzep.com";
const EDGE_PAGE_SIZE = 50;
const MAX_EDGE_PAGES = 5;
const MAX_EPISODES = 8;

const ZEP_CAPABILITIES: MemoryCapabilities = {
	add: true,
	search: true,
	get: true,
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
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		const one = stringValue(value);
		return one ? [one] : [];
	}
	return value
		.map((item) => stringValue(item))
		.filter((item): item is string => !!item);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	const record = asRecord(value);
	return Object.keys(record).length ? record : undefined;
}

function requireScope(filter: { userId?: string; sessionId?: string }): void {
	if (!filter.userId?.trim() && !filter.sessionId?.trim()) {
		throw new Error(getMessage().MEMORY_CONNECTOR_FILTER_REQUIRED);
	}
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

function rowsFrom(raw: unknown, keys: string[]): unknown[] {
	if (Array.isArray(raw)) return raw;
	const body = asRecord(raw);
	for (const key of keys) {
		const value = body[key];
		if (Array.isArray(value)) return value;
	}
	return [];
}

function normalizeMessages(value: unknown): MemoryMessage[] {
	if (!Array.isArray(value)) return [];
	const messages: MemoryMessage[] = [];
	for (const item of value) {
		const row = asRecord(item);
		const content = stringValue(row.content) || stringValue(row.text) || "";
		if (!content) continue;
		messages.push({
			role: stringValue(row.role) || "user",
			content,
		});
	}
	return messages;
}

function normalizeRecord(
	raw: unknown,
	ctx: { userId?: string; sessionId?: string; input?: MemoryMessage[] } = {}
): MemoryRecord | null {
	const row = asRecord(raw);
	const nested = asRecord(row.data);
	const id =
		stringValue(row.uuid) ||
		stringValue(row.uuid_) ||
		stringValue(row.fact_uuid) ||
		stringValue(row.id) ||
		stringValue(nested.uuid) ||
		stringValue(nested.id);
	const fact = stringValue(row.fact) || stringValue(nested.fact);
	const content =
		fact ||
		stringValue(row.summary) ||
		stringValue(row.content) ||
		stringValue(row.text) ||
		stringValue(nested.summary) ||
		stringValue(nested.content) ||
		"";
	if (!id && !content) return null;
	const relationName = fact ? stringValue(row.name) : undefined;
	const labels = [
		...stringList(row.labels ?? nested.labels),
		...(relationName ? [relationName] : []),
	];
	const episodes = stringList(row.episodes ?? nested.episodes);
	const metadata = {
		...asRecord(row.metadata),
		...asRecord(nested.metadata),
		...(stringValue(row.source_node_name)
			? { source: row.source_node_name }
			: {}),
		...(stringValue(row.target_node_name)
			? { target: row.target_node_name }
			: {}),
		...(stringValue(row.valid_at) ? { valid_at: row.valid_at } : {}),
		...(stringValue(row.scope) ? { scope: row.scope } : {}),
		...(!fact && stringValue(row.name) ? { name: row.name } : {}),
		...(fact ? { memory_type: "temporal" } : {}),
		...(!fact && (stringValue(row.summary) || labels.includes("user"))
			? { memory_type: "profile" }
			: {}),
		...(episodes.length ? { episodes } : {}),
	};
	const attributes = objectValue(row.attributes ?? nested.attributes);
	const input = ctx.input?.length
		? ctx.input
		: normalizeMessages(row.messages ?? nested.messages);
	const history = historyFromEdge(row, nested, content);
	const sourceId =
		stringValue(row.source_node_uuid) ||
		stringValue(nested.source_node_uuid) ||
		stringValue(row.source_node_name) ||
		stringValue(nested.source_node_name);
	const targetId =
		stringValue(row.target_node_uuid) ||
		stringValue(nested.target_node_uuid) ||
		stringValue(row.target_node_name) ||
		stringValue(nested.target_node_name);
	const sourceTypes = stringList(
		row.source_node_labels ?? nested.source_node_labels
	);
	const targetTypes = stringList(
		row.target_node_labels ?? nested.target_node_labels
	);
	return {
		id: id || content,
		content,
		userId: stringValue(row.user_id) || stringValue(nested.user_id) || ctx.userId,
		sessionId:
			stringValue(row.session_id) ||
			stringValue(nested.session_id) ||
			stringValue(row.thread_id) ||
			ctx.sessionId,
		metadata: Object.keys(metadata).length ? metadata : undefined,
		categories: labels.length ? labels : undefined,
		input: input.length ? input : undefined,
		history: history.length ? history : undefined,
		structuredAttributes: attributes,
		relation:
			sourceId && targetId
				? {
						source: {
							id: sourceId,
							label:
								stringValue(row.source_node_name) ||
								stringValue(nested.source_node_name) ||
								sourceId,
							types: sourceTypes.length ? sourceTypes : undefined,
						},
						target: {
							id: targetId,
							label:
								stringValue(row.target_node_name) ||
								stringValue(nested.target_node_name) ||
								targetId,
							types: targetTypes.length ? targetTypes : undefined,
						},
						name: relationName,
					}
				: undefined,
		score:
			typeof row.score === "number"
				? row.score
				: typeof row.relevance === "number"
					? row.relevance
					: undefined,
		createdAt:
			stringValue(row.created_at) ||
			stringValue(nested.created_at) ||
			stringValue(row.valid_at),
		updatedAt: stringValue(row.updated_at) || stringValue(nested.updated_at),
		expirationDate:
			stringValue(row.expired_at) ||
			stringValue(row.invalid_at) ||
			stringValue(nested.expired_at),
	};
}

function dedupeRecords(records: MemoryRecord[]): MemoryRecord[] {
	const seen = new Set<string>();
	const next: MemoryRecord[] = [];
	for (const record of records) {
		if (seen.has(record.id)) continue;
		seen.add(record.id);
		next.push(record);
	}
	return next;
}

function normalizeGraph(
	raw: unknown,
	ctx: { userId?: string; sessionId?: string; input?: MemoryMessage[] } = {}
): MemoryRecord[] {
	const body = asRecord(raw);
	const groups = [
		body.edges,
		body.facts,
		body.relevant_facts,
		body.nodes,
		body.results,
		body.episodes,
	];
	const records: MemoryRecord[] = [];
	for (const group of groups) {
		if (!Array.isArray(group)) continue;
		for (const row of group) {
			const record = normalizeRecord(row, ctx);
			if (record) records.push(record);
		}
	}
	if (records.length) return dedupeRecords(records);
	if (Array.isArray(raw)) {
		return dedupeRecords(
			raw
				.map((row) => normalizeRecord(row, ctx))
				.filter((row): row is MemoryRecord => !!row)
		);
	}
	const single = normalizeRecord(raw, ctx);
	return single ? [single] : [];
}

function normalizeSessionMemory(
	raw: unknown,
	sessionId: string,
	userId?: string
): MemoryRecord[] {
	const body = asRecord(raw);
	const messages = normalizeMessages(body.messages);
	const facts = normalizeGraph(raw, { sessionId, userId, input: messages });
	if (facts.length) return facts;
	const context = stringValue(body.context);
	if (context) {
		return [
			{
				id: sessionId,
				content: context,
				sessionId,
				userId,
				metadata: { memory_type: "summary" },
				input: messages.length ? messages : undefined,
			},
		];
	}
	return messages.map((message, index) => ({
		id: `${sessionId}:${index}`,
		content: message.content,
		sessionId,
		userId,
		metadata: { role: message.role, memory_type: "temporal" },
	}));
}

function historyFromEdge(
	row: Record<string, unknown>,
	nested: Record<string, unknown>,
	content: string
): MemoryHistoryEvent[] {
	const created = stringValue(row.created_at) || stringValue(nested.created_at);
	const valid = stringValue(row.valid_at) || stringValue(nested.valid_at);
	const invalid = stringValue(row.invalid_at) || stringValue(nested.invalid_at);
	const expired = stringValue(row.expired_at) || stringValue(nested.expired_at);
	const events: MemoryHistoryEvent[] = [];
	if (created) {
		events.push({ event: "ADD", newMemory: content, createdAt: created });
	}
	if (valid && valid !== created) {
		events.push({ event: "UPDATE", newMemory: content, createdAt: valid });
	}
	if (invalid) {
		events.push({ event: "DELETE", oldMemory: content, createdAt: invalid });
	} else if (expired) {
		events.push({ event: "DELETE", oldMemory: content, createdAt: expired });
	}
	return events;
}

function normalizeUsers(raw: unknown): MemoryFilterChoice[] {
	return uniqueChoices(
		rowsFrom(raw, ["users", "results"]).map((item) => {
			const row = asRecord(item);
			const id = stringValue(row.user_id) || stringValue(row.uuid);
			const name = [stringValue(row.first_name), stringValue(row.last_name)]
				.filter(Boolean)
				.join(" ");
			return {
				id: id || "",
				label: stringValue(row.email) || name || id || "",
			};
		})
	);
}

function normalizeSessions(raw: unknown): MemoryFilterChoice[] {
	return uniqueChoices(
		rowsFrom(raw, ["sessions", "threads", "results"]).map((item) => {
			const row = asRecord(item);
			const id =
				stringValue(row.thread_id) ||
				stringValue(row.session_id) ||
				stringValue(row.uuid);
			return {
				id: id || "",
				label: id || "",
				userId: stringValue(row.user_id),
			};
		})
	);
}

export class ZepAdapter extends BaseMemoryAdapter {
	readonly type = "zep";

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
				const apiKey = secret.credentials.apiKey || secret.raw;
				return apiKey ? { Authorization: `Api-Key ${apiKey}` } : {};
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

	private async firstRecord(
		attempts: Array<() => Promise<unknown>>
	): Promise<MemoryRecord | null> {
		for (const attempt of attempts) {
			try {
				const records = normalizeGraph(await attempt());
				if (records[0]) return records[0];
			} catch {
				continue;
			}
		}
		return null;
	}

	capabilities(): MemoryCapabilities {
		return { ...ZEP_CAPABILITIES };
	}

	async healthCheck(): Promise<ConnectorHealthResult> {
		const started = Date.now();
		try {
			await this.requestFirst(
				["api/v2/users-ordered?pageSize=1&pageNumber=1", "api/v2/users"],
				{ timeoutMs: 10_000 }
			);
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
		const sessionId = input.sessionId?.trim();
		if (!sessionId) throw new Error(getMessage().MEMORY_CONNECTOR_SESSION_REQUIRED);
		const messages = input.messages?.length
			? input.messages
			: input.content?.trim()
				? [{ role: "user", content: input.content.trim() }]
				: [];
		if (!messages.length) {
			throw new Error(getMessage().MEMORY_CONNECTOR_CONTENT_REQUIRED);
		}
		const encoded = encodeURIComponent(sessionId);
		const body = await this.requestFirst(
			[`api/v2/threads/${encoded}/messages`, `api/v2/sessions/${encoded}/memory`],
			{
				method: "POST",
				body: {
					messages,
					return_context: true,
					...(input.userId ? { user_id: input.userId } : {}),
					...(input.metadata ? { metadata: input.metadata } : {}),
				},
			}
		);
		const records = normalizeSessionMemory(body, sessionId, input.userId);
		return records.length
			? records
			: [
					{
						id: sessionId,
						content: messages.map((item) => item.content).join("\n"),
						sessionId,
						userId: input.userId,
						input: messages,
					},
				];
	}

	async search(query: MemorySearchQuery): Promise<MemoryRecord[]> {
		const q = query.query.trim();
		if (!q) throw new Error(getMessage().MEMORY_CONNECTOR_QUERY_REQUIRED);
		requireScope(query);
		const sessionId = query.sessionId?.trim();
		const userId = query.userId?.trim();
		if (sessionId) {
			try {
				const body = await this.request(
					`api/v2/sessions/${encodeURIComponent(sessionId)}/search`,
					{
						method: "POST",
						body: { text: q, limit: query.limit || 10 },
					}
				);
				return normalizeGraph(body, { sessionId, userId }).slice(
					0,
					query.limit || 10
				);
			} catch (error) {
				if (!userId) throw error;
			}
		}
		const body = await this.request("api/v2/graph/search", {
			method: "POST",
			body: {
				user_id: userId,
				query: q,
				limit: query.limit || 10,
			},
		});
		return normalizeGraph(body, { userId, sessionId }).slice(0, query.limit || 10);
	}

	async get(id: string): Promise<MemoryRecord | null> {
		const trimmed = id.trim();
		if (!trimmed) return null;
		const encoded = encodeURIComponent(trimmed);
		const graph = await this.firstRecord([
			() => this.request(`api/v2/graph/edge/${encoded}`),
			() => this.request(`api/v2/graph/node/${encoded}`),
		]);
		if (graph) return this.enrichRecord(graph);
		try {
			const body = await this.requestFirst([
				`api/v2/threads/${encoded}/context`,
				`api/v2/sessions/${encoded}/memory`,
			]);
			return normalizeSessionMemory(body, trimmed)[0] || null;
		} catch {
			return null;
		}
	}

	async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
		requireScope(filter);
		const sessionId = filter.sessionId?.trim();
		let userId = filter.userId?.trim();
		const limit = filter.limit || 25;
		if (!userId && sessionId) {
			userId = await this.userIdForThread(sessionId);
		}
		if (userId) {
			return (await this.listUserGraph(userId, limit)).slice(0, limit);
		}
		if (!sessionId) return [];
		const encoded = encodeURIComponent(sessionId);
		const body = await this.requestFirst(
			[`api/v2/threads/${encoded}/context`, `api/v2/sessions/${encoded}/memory`]
		);
		return normalizeSessionMemory(body, sessionId).slice(0, limit);
	}

	async listFilters(): Promise<MemoryFilterOptions> {
		const filters = emptyMemoryFilters();
		try {
			filters.users = normalizeUsers(
				await this.requestFirst([
					"api/v2/users-ordered?pageSize=100&pageNumber=1",
					"api/v2/users",
				])
			);
		} catch {
			filters.users = [];
		}
		try {
			filters.sessions = normalizeSessions(
				await this.requestFirst([
					"api/v2/threads?page_size=100&page_number=1",
					"api/v2/sessions",
				])
			);
		} catch {
			filters.sessions = [];
		}
		return filters;
	}

	async delete(id: string): Promise<void> {
		const trimmed = id.trim();
		if (!trimmed) return;
		try {
			await this.request(`api/v2/graph/edge/${encodeURIComponent(trimmed)}`, {
				method: "DELETE",
			});
			return;
		} catch {
			await this.request(`api/v2/graph/node/${encodeURIComponent(trimmed)}`, {
				method: "DELETE",
			});
		}
	}

	private async listUserGraph(
		userId: string,
		limit: number
	): Promise<MemoryRecord[]> {
		const collected: MemoryRecord[] = [];
		let uuidCursor: string | undefined;
		const pageSize = Math.min(EDGE_PAGE_SIZE, Math.max(limit, 1));
		for (let page = 0; page < MAX_EDGE_PAGES && collected.length < limit; page++) {
			try {
				const edges = await this.request(
					`api/v2/graph/edge/user/${encodeURIComponent(userId)}`,
					{
						method: "POST",
						body: {
							limit: Math.min(pageSize, limit - collected.length),
							...(uuidCursor ? { uuid_cursor: uuidCursor } : {}),
						},
					}
				);
				const records = normalizeGraph(edges, { userId });
				if (!records.length) break;
				collected.push(...records);
				if (records.length < pageSize) break;
				uuidCursor = records[records.length - 1]?.id;
				if (!uuidCursor) break;
			} catch {
				break;
			}
		}
		if (collected.length) {
			const facts = dedupeRecords(collected).slice(0, limit);
			const factIds = new Set(facts.map((record) => record.id));
			try {
				const nodes = await this.request(
					`api/v2/graph/node/user/${encodeURIComponent(userId)}`,
					{
						method: "POST",
						body: { limit: 100 },
					}
				);
				const extras = normalizeGraph(nodes, { userId })
					.filter((record) => !factIds.has(record.id))
					.map((record) => ({ ...record, graphOnly: true }));
				return [...facts, ...extras];
			} catch {
				return facts;
			}
		}
		const nodes = await this.request(
			`api/v2/graph/node/user/${encodeURIComponent(userId)}`,
			{
				method: "POST",
				body: { limit },
			}
		);
		return normalizeGraph(nodes, { userId });
	}

	private async userIdForThread(sessionId: string): Promise<string | undefined> {
		const encoded = encodeURIComponent(sessionId);
		try {
			const body = asRecord(
				await this.requestFirst([
					`api/v2/threads/${encoded}/messages?limit=1`,
					`api/v2/sessions/${encoded}`,
				])
			);
			return (
				stringValue(body.user_id) ||
				stringValue(asRecord(body.session).user_id)
			);
		} catch {
			return undefined;
		}
	}

	private async enrichRecord(record: MemoryRecord): Promise<MemoryRecord> {
		if (record.input?.length) return record;
		const episodes = stringList(record.metadata?.episodes);
		if (!episodes.length) return record;
		const input = await this.episodesAsMessages(episodes);
		return input.length ? { ...record, input } : record;
	}

	private async episodesAsMessages(ids: string[]): Promise<MemoryMessage[]> {
		const messages: MemoryMessage[] = [];
		for (const id of ids.slice(0, MAX_EPISODES)) {
			try {
				const row = asRecord(
					await this.request(`api/v2/graph/episodes/${encodeURIComponent(id)}`)
				);
				const content = stringValue(row.content);
				if (!content) continue;
				messages.push({
					role: stringValue(row.role) || stringValue(row.role_type) || "user",
					content,
				});
			} catch {
				continue;
			}
		}
		return messages;
	}
}

export const zepAdapterFactory = {
	type: "zep",
	create: (descriptor: MemorySourceDescriptor) => new ZepAdapter(descriptor),
	describe: (): MemoryTypeDescriptor => ({
		type: "zep",
		displayName: "Zep",
		description: getMessage().MEMORY_CONNECTOR_ZEP_DESCRIPTION,
		capabilities: { ...ZEP_CAPABILITIES },
		configFields: memoryHttpVendorFields({ placeholder: DEFAULT_URL }),
		filterFields: memoryPageFilters([
			{ key: "userId", required: true },
			{ key: "sessionId", writeRequired: true },
		]),
		authStyle: "api-key",
		authHelp: getMessage().MEMORY_CONNECTOR_AUTH_HELP_ZEP,
		docsUrl: "https://help.getzep.com/sdk-reference",
	}),
};
