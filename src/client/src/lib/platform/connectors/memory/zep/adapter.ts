/**
 * Zep memory connector.
 *
 * Talks to the Zep Cloud REST API (hosted `https://api.getzep.com` or a
 * self-hosted compatible endpoint). Session-scoped add/list/search/delete
 * are supported; per-memory get/update are not advertised.
 */

import getMessage from "@/constants/messages";
import type { ConnectorHealthResult } from "../../types";
import type { ResolvedSecret } from "../../datasource/http/secret";
import { BaseMemoryAdapter } from "../base-adapter";
import { memoryHttpVendorFields } from "../config-fields";
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

const DEFAULT_URL = "https://api.getzep.com";

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

function requireSessionId(sessionId?: string): string {
	const id = sessionId?.trim();
	if (!id) throw new Error(getMessage().MEMORY_CONNECTOR_SESSION_REQUIRED);
	return id;
}

function normalizeMessage(raw: unknown, sessionId?: string): MemoryRecord | null {
	const row = asRecord(raw);
	const id =
		stringValue(row.uuid) ||
		stringValue(row.uuid_) ||
		stringValue(row.id) ||
		stringValue(row.fact_uuid);
	const content =
		stringValue(row.content) ||
		stringValue(row.fact) ||
		stringValue(row.text) ||
		"";
	if (!id && !content) return null;
	return {
		id: id || content,
		content,
		userId: stringValue(row.user_id),
		sessionId: stringValue(row.session_id) || sessionId,
		metadata: asRecord(row.metadata),
		score: typeof row.score === "number" ? row.score : undefined,
		createdAt: stringValue(row.created_at),
		updatedAt: stringValue(row.updated_at),
	};
}

function normalizeList(raw: unknown, sessionId?: string): MemoryRecord[] {
	const body = asRecord(raw);
	const candidates = [
		body.messages,
		body.facts,
		body.results,
		body.edges,
		body.context,
	];
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) {
			return candidate
				.map((row) => normalizeMessage(row, sessionId))
				.filter((row): row is MemoryRecord => !!row);
		}
	}
	if (typeof body.context === "string" && body.context.trim()) {
		return [
			{
				id: sessionId || "context",
				content: body.context,
				sessionId,
			},
		];
	}
	if (Array.isArray(raw)) {
		return raw
			.map((row) => normalizeMessage(row, sessionId))
			.filter((row): row is MemoryRecord => !!row);
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

function rowsFrom(raw: unknown, keys: string[]): unknown[] {
	if (Array.isArray(raw)) return raw;
	const body = asRecord(raw);
	for (const key of keys) {
		const value = body[key];
		if (Array.isArray(value)) return value;
	}
	return [];
}

function normalizeUsers(raw: unknown): MemoryFilterChoice[] {
	return uniqueChoices(
		rowsFrom(raw, ["users", "results"]).map((item) => {
			const row = asRecord(item);
			const id = stringValue(row.user_id) || stringValue(row.uuid) || stringValue(row.id);
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
		rowsFrom(raw, ["sessions", "results"]).map((item) => {
			const row = asRecord(item);
			const id =
				stringValue(row.session_id) || stringValue(row.uuid) || stringValue(row.id);
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

	capabilities(): MemoryCapabilities {
		return {
			add: true,
			search: true,
			get: false,
			list: true,
			update: false,
			delete: true,
		};
	}

	async healthCheck(): Promise<ConnectorHealthResult> {
		const started = Date.now();
		try {
			await this.request("api/v2/users", {
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
		const sessionId = requireSessionId(input.sessionId);
		const messages = input.messages?.length
			? input.messages
			: input.content?.trim()
				? [{ role: "user", content: input.content.trim() }]
				: [];
		if (!messages.length) {
			throw new Error(getMessage().MEMORY_CONNECTOR_CONTENT_REQUIRED);
		}
		const body = await this.request(
			`api/v2/sessions/${encodeURIComponent(sessionId)}/memory`,
			{
				method: "POST",
				body: {
					messages,
					...(input.userId ? { user_id: input.userId } : {}),
					...(input.metadata ? { metadata: input.metadata } : {}),
				},
			}
		);
		const records = normalizeList(body, sessionId);
		return records.length ? records : [{ id: sessionId, content: messages.map((item) => item.content).join("\n"), sessionId, userId: input.userId }];
	}

	async search(query: MemorySearchQuery): Promise<MemoryRecord[]> {
		const q = query.query.trim();
		if (!q) throw new Error(getMessage().MEMORY_CONNECTOR_QUERY_REQUIRED);
		const sessionId = query.sessionId?.trim();
		if (sessionId) {
			const body = await this.request(
				`api/v2/sessions/${encodeURIComponent(sessionId)}/search`,
				{
					method: "POST",
					body: { text: q, limit: query.limit || 10 },
				}
			);
			return normalizeList(body, sessionId);
		}
		if (!query.userId?.trim()) {
			throw new Error(getMessage().MEMORY_CONNECTOR_SESSION_REQUIRED);
		}
		const body = await this.request("api/v2/graph/search", {
			method: "POST",
			body: {
				user_id: query.userId,
				query: q,
				limit: query.limit || 10,
			},
		});
		return normalizeList(body, query.sessionId);
	}

	async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
		const sessionId = requireSessionId(filter.sessionId);
		const body = await this.request(
			`api/v2/sessions/${encodeURIComponent(sessionId)}/memory`
		);
		return normalizeList(body, sessionId).slice(0, filter.limit || 25);
	}

	async listFilters(): Promise<MemoryFilterOptions> {
		const filters = emptyMemoryFilters();
		try {
			filters.users = normalizeUsers(await this.request("api/v2/users"));
		} catch {
			filters.users = [];
		}
		try {
			filters.sessions = normalizeSessions(await this.request("api/v2/sessions"));
		} catch {
			filters.sessions = [];
		}
		return filters;
	}

	async delete(id: string): Promise<void> {
		await this.request(`api/v2/sessions/${encodeURIComponent(id)}/memory`, {
			method: "DELETE",
		});
	}
}

export const zepAdapterFactory = {
	type: "zep",
	create: (descriptor: MemorySourceDescriptor) => new ZepAdapter(descriptor),
	describe: (): MemoryTypeDescriptor => ({
		type: "zep",
		displayName: "Zep",
		description: getMessage().MEMORY_CONNECTOR_ZEP_DESCRIPTION,
		capabilities: {
			add: true,
			search: true,
			get: false,
			list: true,
			update: false,
			delete: true,
		},
		configFields: memoryHttpVendorFields({ placeholder: DEFAULT_URL }),
		authStyle: "api-key",
		authHelp: getMessage().MEMORY_CONNECTOR_AUTH_HELP_ZEP,
		docsUrl: "https://help.getzep.com/sdk-reference",
	}),
};
