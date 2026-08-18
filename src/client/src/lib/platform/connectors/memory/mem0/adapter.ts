/**
 * Mem0 memory connector.
 *
 * Talks to the Mem0 Platform REST API (hosted `https://api.mem0.ai` or a
 * self-hosted compatible endpoint). Credentials stay in the OpenLIT vault
 * and are sent as `Authorization: Token <apiKey>`.
 */

import getMessage from "@/constants/messages";
import type { ConnectorHealthResult } from "../../types";
import type { ResolvedSecret } from "../../datasource/http/secret";
import { BaseMemoryAdapter } from "../base-adapter";
import { memoryHttpVendorFields, memoryPageFilters } from "../config-fields";
import { memoryBaseUrl, memoryRequest } from "../http";
import type {
	MemoryCapabilities,
	MemoryFeedback,
	MemoryFeedbackInput,
	MemoryFeedbackRating,
	MemoryFilterChoice,
	MemoryFilterOptions,
	MemoryHistoryEvent,
	MemoryListFilter,
	MemoryMessage,
	MemoryRecord,
	MemorySearchQuery,
	MemorySourceDescriptor,
	MemoryTypeDescriptor,
	MemoryUpdateInput,
	MemoryWriteInput,
} from "../types";
import { emptyMemoryFilters } from "../types";

const DEFAULT_URL = "https://api.mem0.ai";

const MEM0_CAPABILITIES = {
	add: true,
	search: true,
	get: true,
	list: true,
	update: true,
	delete: true,
	feedback: true,
} as const;

const MEM0_FEEDBACK_TO_RATING: Record<string, MemoryFeedbackRating> = {
	POSITIVE: "positive",
	NEGATIVE: "negative",
	VERY_NEGATIVE: "very_negative",
};

const RATING_TO_MEM0_FEEDBACK: Record<MemoryFeedbackRating, string> = {
	positive: "POSITIVE",
	negative: "NEGATIVE",
	very_negative: "VERY_NEGATIVE",
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

function objectValue(value: unknown): Record<string, unknown> | undefined {
	const record = asRecord(value);
	return Object.keys(record).length ? record : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function normalizeFeedback(raw: unknown): MemoryFeedback | undefined {
	const row = asRecord(raw);
	const nested = asRecord(row.data);
	const token = (
		stringValue(row.feedback) ||
		stringValue(nested.feedback) ||
		""
	)
		.trim()
		.toUpperCase()
		.replace(/[\s-]+/g, "_");
	const rating = token ? MEM0_FEEDBACK_TO_RATING[token] : undefined;
	const reason =
		stringValue(row.feedback_reason) ||
		stringValue(row.feedbackReason) ||
		stringValue(nested.feedback_reason);
	if (!rating && !reason) return undefined;
	return {
		...(rating ? { rating } : {}),
		...(reason ? { reason } : {}),
	};
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

function normalizeHistory(raw: unknown): MemoryHistoryEvent[] {
	const body = asRecord(raw);
	const rows = Array.isArray(raw)
		? raw
		: Array.isArray(body.results)
			? body.results
			: Array.isArray(body.history)
				? body.history
				: [];
	const events: MemoryHistoryEvent[] = [];
	for (const item of rows) {
		const row = asRecord(item);
		const event = stringValue(row.event) || stringValue(row.action);
		const oldMemory = stringValue(row.old_memory) || stringValue(row.oldMemory);
		const newMemory = stringValue(row.new_memory) || stringValue(row.newMemory);
		const input = normalizeMessages(row.input || row.messages);
		if (!event && !oldMemory && !newMemory && !input.length) continue;
		events.push({
			id: stringValue(row.id) || stringValue(row.history_id),
			event: event || "UPDATE",
			input: input.length ? input : undefined,
			oldMemory,
			newMemory,
			createdAt: stringValue(row.created_at) || stringValue(row.updated_at),
			actorId: stringValue(row.actor_id) || stringValue(row.user_id),
		});
	}
	return events;
}

function inputFromHistory(history: MemoryHistoryEvent[]): MemoryMessage[] {
	for (const event of history) {
		if (event.input?.length) return event.input;
	}
	return [];
}

function normalizeRecord(
	raw: unknown,
	extras: { history?: MemoryHistoryEvent[] } = {}
): MemoryRecord | null {
	const row = asRecord(raw);
	const nested = asRecord(row.data);
	const id = stringValue(row.id) || stringValue(nested.id);
	const content =
		stringValue(row.memory) ||
		stringValue(row.text) ||
		stringValue(nested.memory) ||
		stringValue(nested.text) ||
		"";
	if (!id && !content) return null;
	const metadata = objectValue(row.metadata || nested.metadata);
	const categories = stringList(row.categories ?? nested.categories);
	const history = extras.history?.length
		? extras.history
		: normalizeHistory(row.history ?? nested.history);
	const input = normalizeMessages(
		row.input ?? row.messages ?? nested.input ?? nested.messages
	);
	const resolvedInput = input.length ? input : inputFromHistory(history);
	const structuredAttributes = objectValue(
		row.structured_attributes ?? nested.structured_attributes
	);
	return {
		id: id || content,
		content,
		userId: stringValue(row.user_id) || stringValue(nested.user_id),
		agentId: stringValue(row.agent_id) || stringValue(nested.agent_id),
		sessionId:
			stringValue(row.run_id) ||
			stringValue(row.session_id) ||
			stringValue(nested.run_id) ||
			stringValue(nested.session_id),
		appId: stringValue(row.app_id) || stringValue(nested.app_id),
		metadata,
		categories: categories.length ? categories : undefined,
		input: resolvedInput.length ? resolvedInput : undefined,
		history: history.length ? history : undefined,
		score: typeof row.score === "number" ? row.score : undefined,
		createdAt: stringValue(row.created_at) || stringValue(nested.created_at),
		updatedAt: stringValue(row.updated_at) || stringValue(nested.updated_at),
		expirationDate:
			stringValue(row.expiration_date) || stringValue(nested.expiration_date),
		structuredAttributes,
		synthesized:
			booleanValue(row.synthesized) ?? booleanValue(nested.synthesized),
		lifecycleState:
			stringValue(row.lifecycle_state) || stringValue(nested.lifecycle_state),
		feedback: normalizeFeedback(row) || normalizeFeedback(nested),
	};
}

function normalizeList(raw: unknown): MemoryRecord[] {
	if (Array.isArray(raw)) {
		return raw.map(normalizeRecord).filter((row): row is MemoryRecord => !!row);
	}
	const body = asRecord(raw);
	const rows = body.results ?? body.memories ?? body.data;
	if (!Array.isArray(rows)) {
		const single = normalizeRecord(raw);
		return single ? [single] : [];
	}
	return rows.map(normalizeRecord).filter((row): row is MemoryRecord => !!row);
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

function entityKind(row: Record<string, unknown>): "user" | "agent" | "session" | null {
	const type = (
		stringValue(row.type) ||
		stringValue(row.entity_type) ||
		stringValue(row.owner) ||
		"user"
	).toLowerCase();
	if (type === "run" || type === "session") return "session";
	if (type === "agent") return "agent";
	if (type === "app") return null;
	return "user";
}

function normalizeEntities(raw: unknown): MemoryFilterOptions {
	const body = asRecord(raw);
	const rows = Array.isArray(raw)
		? raw
		: Array.isArray(body.results)
			? body.results
			: Array.isArray(body.entities)
				? body.entities
				: [];
	const users: MemoryFilterChoice[] = [];
	const sessions: MemoryFilterChoice[] = [];
	const agents: MemoryFilterChoice[] = [];
	for (const item of rows) {
		const row = asRecord(item);
		const id =
			stringValue(row.name) ||
			stringValue(row.user_id) ||
			stringValue(row.agent_id) ||
			stringValue(row.run_id) ||
			stringValue(row.id);
		if (!id) continue;
		const kind = entityKind(row);
		if (!kind) continue;
		const choice = { id, label: stringValue(row.email) || id };
		if (kind === "agent") agents.push(choice);
		else if (kind === "session") sessions.push(choice);
		else users.push(choice);
	}
	return {
		users: uniqueChoices(users),
		sessions: uniqueChoices(sessions),
		agents: uniqueChoices(agents),
	};
}

function isRedirectBudgetError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /maximum number of redirects|redirect loop/i.test(message);
}

function messagesForWrite(input: MemoryWriteInput) {
	if (input.messages?.length) return input.messages;
	if (input.content?.trim()) {
		return [{ role: "user", content: input.content.trim() }];
	}
	return [];
}

export class Mem0Adapter extends BaseMemoryAdapter {
	readonly type = "mem0";

	private get baseUrl(): string {
		return memoryBaseUrl(this.descriptor, DEFAULT_URL);
	}

	private orgScope() {
		const orgId = stringValue(this.descriptor.settings.orgId);
		const projectId = stringValue(this.descriptor.settings.projectId);
		return {
			...(orgId ? { org_id: orgId } : {}),
			...(projectId ? { project_id: projectId } : {}),
		};
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
				return apiKey ? { Authorization: `Token ${apiKey}` } : {};
			},
		});
	}

	/**
	 * Mem0 routes are slash-terminated. A 301/307 `Location` that is path-relative
	 * (no leading slash) nests under the current resource and exhausts the
	 * redirect budget. Retry once without the trailing slash so origin-relative
	 * resolution can land on the canonical URL.
	 */
	private requestSlash<T>(
		path: string,
		opts: {
			method?: string;
			body?: unknown;
			timeoutMs?: number;
		} = {}
	): Promise<T> {
		return this.request<T>(path, opts).catch((error) => {
			if (!isRedirectBudgetError(error) || !path.endsWith("/")) throw error;
			return this.request<T>(path.replace(/\/+$/, ""), opts);
		});
	}

	capabilities(): MemoryCapabilities {
		return { ...MEM0_CAPABILITIES };
	}

	async healthCheck(): Promise<ConnectorHealthResult> {
		const started = Date.now();
		try {
			await this.request("v1/entities/", {
				timeoutMs: 10_000,
			});
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
		const messages = messagesForWrite(input);
		if (!messages.length) {
			throw new Error(getMessage().MEMORY_CONNECTOR_CONTENT_REQUIRED);
		}
		const body = await this.request("v1/memories/", {
			method: "POST",
			body: {
				messages,
				user_id: input.userId,
				agent_id: input.agentId,
				run_id: input.sessionId,
				metadata: input.metadata,
				...this.orgScope(),
			},
		});
		return normalizeList(body);
	}

	async search(query: MemorySearchQuery): Promise<MemoryRecord[]> {
		const q = query.query.trim();
		if (!q) throw new Error(getMessage().MEMORY_CONNECTOR_QUERY_REQUIRED);
		const filters: Record<string, string> = {};
		if (query.userId) filters.user_id = query.userId;
		if (query.agentId) filters.agent_id = query.agentId;
		if (query.sessionId) filters.run_id = query.sessionId;
		const body = await this.request("v2/memories/search/", {
			method: "POST",
			body: {
				query: q,
				filters: Object.keys(filters).length ? filters : undefined,
				top_k: query.limit || 10,
				threshold: query.threshold,
				...this.orgScope(),
			},
		});
		return normalizeList(body);
	}

	async get(id: string): Promise<MemoryRecord | null> {
		const encoded = encodeURIComponent(id);
		const body = await this.requestSlash(`v1/memories/${encoded}/`);
		let history: MemoryHistoryEvent[] = [];
		try {
			history = normalizeHistory(
				await this.requestSlash(`v1/memories/${encoded}/history/`)
			);
		} catch {
			history = [];
		}
		return normalizeRecord(body, { history });
	}

	async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
		if (!filter.userId && !filter.agentId && !filter.sessionId) {
			throw new Error(getMessage().MEMORY_CONNECTOR_FILTER_REQUIRED);
		}
		const params = new URLSearchParams();
		if (filter.userId) params.set("user_id", filter.userId);
		if (filter.agentId) params.set("agent_id", filter.agentId);
		if (filter.sessionId) params.set("run_id", filter.sessionId);
		params.set("page_size", String(filter.limit || 25));
		const query = params.toString();
		const body = await this.request(`v1/memories/${query ? `?${query}` : ""}`);
		return normalizeList(body);
	}

	async listFilters(): Promise<MemoryFilterOptions> {
		const params = new URLSearchParams();
		params.set("page_size", "100");
		const scope = this.orgScope();
		if (scope.org_id) params.set("org_id", scope.org_id);
		if (scope.project_id) params.set("project_id", scope.project_id);
		try {
			const body = await this.request(`v1/entities/?${params.toString()}`);
			return normalizeEntities(body);
		} catch {
			return emptyMemoryFilters();
		}
	}

	async update(id: string, input: MemoryUpdateInput): Promise<MemoryRecord> {
		const body = await this.requestSlash(`v1/memories/${encodeURIComponent(id)}/`, {
			method: "PUT",
			body: {
				text: input.content,
				metadata: input.metadata,
			},
		});
		return (
			normalizeRecord(body) || {
				id,
				content: input.content,
				metadata: input.metadata,
			}
		);
	}

	async delete(id: string): Promise<void> {
		await this.requestSlash(`v1/memories/${encodeURIComponent(id)}/`, {
			method: "DELETE",
		});
	}

	async feedback(id: string, input: MemoryFeedbackInput): Promise<MemoryFeedback> {
		const memoryId = id.trim();
		if (!memoryId) throw new Error(getMessage().MEMORY_DETAIL_NOT_FOUND);
		const body = await this.requestSlash("v1/feedback/", {
			method: "POST",
			body: {
				memory_id: memoryId,
				feedback: input.rating ? RATING_TO_MEM0_FEEDBACK[input.rating] : null,
				feedback_reason: input.reason?.trim() || null,
			},
		});
		return (
			normalizeFeedback(body) ||
			(input.rating || input.reason?.trim()
				? {
						...(input.rating ? { rating: input.rating } : {}),
						...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
					}
				: {})
		);
	}
}

export const mem0AdapterFactory = {
	type: "mem0",
	create: (descriptor: MemorySourceDescriptor) => new Mem0Adapter(descriptor),
	describe: (): MemoryTypeDescriptor => ({
		type: "mem0",
		displayName: "Mem0",
		description: getMessage().MEMORY_CONNECTOR_MEM0_DESCRIPTION,
		capabilities: { ...MEM0_CAPABILITIES },
		configFields: [
			...memoryHttpVendorFields({ placeholder: DEFAULT_URL }),
			{
				key: "orgId",
				label: getMessage().MEMORY_CONNECTOR_FIELD_ORG_ID,
				kind: "text",
				group: "settings",
			},
			{
				key: "projectId",
				label: getMessage().MEMORY_CONNECTOR_FIELD_PROJECT_ID,
				kind: "text",
				group: "settings",
			},
		],
		filterFields: memoryPageFilters(["userId", "sessionId", "agentId"]),
		authStyle: "api-key",
		authHelp: getMessage().MEMORY_CONNECTOR_AUTH_HELP_MEM0,
		docsUrl: "https://docs.mem0.ai/api-reference",
	}),
};
