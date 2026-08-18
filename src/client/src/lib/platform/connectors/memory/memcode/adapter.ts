/**
 * MemCode memory connector.
 *
 * Talks to Memory API v2 (`https://memory.memcode.in`): ingest, search, and
 * retrieve. Credentials stay on the connector (`enc:v1:`) and are sent as
 * `Authorization: Bearer <apiKey>`. Every route requires a stable `user_id`.
 *
 * @see https://memcode.in/docs
 */

import getMessage from "@/constants/messages";
import type { ConnectorHealthResult } from "../../types";
import type { ResolvedSecret } from "../../datasource/http/secret";
import { SourceResponseError } from "../../datasource/http/safe-fetch";
import { BaseMemoryAdapter } from "../base-adapter";
import { memoryHttpVendorFields, memoryPageFilters } from "../config-fields";
import { memoryBaseUrl, memoryRequest } from "../http";
import type {
	MemoryCapabilities,
	MemoryListFilter,
	MemoryMessage,
	MemoryRecord,
	MemorySearchQuery,
	MemorySourceDescriptor,
	MemoryTypeDescriptor,
	MemoryWriteInput,
} from "../types";

const DEFAULT_URL = "https://memory.memcode.in";
const DOCS_URL = "https://memcode.in/docs";
const MEMCODE_DOMAINS = ["profile", "temporal", "summary"] as const;
const LIST_RECALLS = [
	{
		query: "Who is this user? What identity, preferences, and profile facts do you know?",
		domains: ["profile"],
	},
	{
		query: "What recent events, dates, and changes happened for this user?",
		domains: ["temporal"],
	},
	{
		query: "Summarize everything stored about this user.",
		domains: ["summary"],
	},
] as const;
const POLL_DEADLINE_MS = 8_000;

const MEMCODE_CAPABILITIES: MemoryCapabilities = {
	add: true,
	search: true,
	get: false,
	list: true,
	update: false,
	delete: false,
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

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	const record = asRecord(value);
	return Object.keys(record).length ? record : undefined;
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

function requireUserId(userId?: string): string {
	const next = userId?.trim();
	if (!next) throw new Error(getMessage().MEMORY_CONNECTOR_FILTER_REQUIRED);
	return next;
}

function unwrap(raw: unknown): Record<string, unknown> {
	const body = asRecord(raw);
	if (stringValue(body.status) === "error") {
		throw new Error(
			stringValue(body.error) || "The MemCode request could not be completed."
		);
	}
	const data = body.data;
	if (data && typeof data === "object" && !Array.isArray(data)) {
		return data as Record<string, unknown>;
	}
	return body;
}

function stableId(domain: string, content: string, index: number): string {
	let hash = 0;
	const key = `${domain}:${content}`;
	for (let i = 0; i < key.length; i += 1) {
		hash = (hash * 31 + key.charCodeAt(i)) | 0;
	}
	return `${domain || "memory"}:${Math.abs(hash).toString(16) || String(index)}`;
}

function normalizeRecord(
	raw: unknown,
	ctx: { userId?: string; index?: number } = {}
): MemoryRecord | null {
	const row = asRecord(raw);
	const content =
		stringValue(row.content) ||
		stringValue(row.memory) ||
		stringValue(row.answer) ||
		stringValue(row.text) ||
		"";
	if (!content) return null;
	const metadata = objectValue(row.metadata) || {};
	const domain =
		stringValue(row.domain) ||
		stringValue(metadata.domain) ||
		stringValue(metadata.category) ||
		"summary";
	const id =
		stringValue(row.id) ||
		stringValue(row.ref) ||
		stringValue(metadata.id) ||
		stringValue(metadata.memory_id) ||
		stringValue(metadata.ref) ||
		stableId(domain, content, ctx.index || 0);
	const categories = stringList(row.categories);
	if (domain && !categories.includes(domain)) categories.unshift(domain);
	return {
		id,
		content,
		userId: stringValue(row.user_id) || ctx.userId,
		metadata: {
			...metadata,
			domain,
			category: stringValue(metadata.category) || domain,
		},
		categories: categories.length ? categories : undefined,
		score: numberValue(row.score) ?? numberValue(row.confidence),
		createdAt: stringValue(row.created_at),
		updatedAt: stringValue(row.updated_at),
	};
}

function normalizeHits(raw: unknown, userId?: string): MemoryRecord[] {
	const data = unwrap(raw);
	const rows = [
		...(Array.isArray(data.memory_results) ? data.memory_results : []),
		...(Array.isArray(data.original_chunks) ? data.original_chunks : []),
		...(Array.isArray(data.results) ? data.results : []),
		...(Array.isArray(data.sources) ? data.sources : []),
	];
	const records: MemoryRecord[] = [];
	const seen = new Set<string>();
	rows.forEach((item, index) => {
		const record = normalizeRecord(item, { userId, index });
		if (!record || seen.has(record.id)) return;
		seen.add(record.id);
		records.push(record);
	});
	return records;
}

function ingestPayload(input: MemoryWriteInput, userId: string) {
	const messages = input.messages || [];
	const lastUser = [...messages]
		.reverse()
		.find((message) => message.role === "user" && message.content.trim());
	const lastAssistant = [...messages]
		.reverse()
		.find((message) => message.role === "assistant" && message.content.trim());
	const userQuery =
		lastUser?.content.trim() || input.content?.trim() || messagesForWrite(messages);
	if (!userQuery) {
		throw new Error(getMessage().MEMORY_CONNECTOR_CONTENT_REQUIRED);
	}
	return {
		user_query: userQuery.slice(0, 10_000),
		user_id: userId,
		...(lastAssistant
			? { agent_response: lastAssistant.content.trim().slice(0, 10_000) }
			: {}),
		session_datetime: new Date().toISOString(),
	};
}

function messagesForWrite(messages: MemoryMessage[]): string {
	return messages
		.map((message) => message.content.trim())
		.filter(Boolean)
		.join("\n")
		.slice(0, 10_000);
}

function statusPath(jobId: string, statusUrl?: string): string {
	const relative = stringValue(statusUrl)?.replace(/^\//, "");
	if (relative && !/^https?:/i.test(relative)) return relative;
	return `v2/memory/ingest/${encodeURIComponent(jobId)}/status`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MemcodeAdapter extends BaseMemoryAdapter {
	readonly type = "memcode";

	private get baseUrl(): string {
		return memoryBaseUrl(this.descriptor, DEFAULT_URL);
	}

	private request<T>(
		path: string,
		opts: {
			method?: string;
			body?: unknown;
			headers?: Record<string, string>;
			timeoutMs?: number;
		} = {}
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
		return { ...MEMCODE_CAPABILITIES };
	}

	async healthCheck(): Promise<ConnectorHealthResult> {
		const started = Date.now();
		try {
			await this.request("v2/memory/search", {
				method: "POST",
				body: { query: "health", user_id: "openlit-health" },
				timeoutMs: 10_000,
			});
			return { ok: true, latencyMs: Date.now() - started };
		} catch (error) {
			const status = error instanceof SourceResponseError ? error.status : undefined;
			if (status && status !== 401 && status !== 403 && status !== 402 && status < 500) {
				return { ok: true, latencyMs: Date.now() - started };
			}
			return {
				ok: false,
				latencyMs: Date.now() - started,
				message: String((error as Error)?.message || error),
			};
		}
	}

	async add(input: MemoryWriteInput): Promise<MemoryRecord[]> {
		const userId = requireUserId(input.userId);
		const payload = ingestPayload(input, userId);
		const ingested = unwrap(
			await this.request("v2/memory/ingest", {
				method: "POST",
				body: payload,
				headers: {
					"Idempotency-Key": `openlit-${this.descriptor.id}-${Date.now()}`,
				},
			})
		);
		const jobId =
			stringValue(ingested.job_id) ||
			stringValue(ingested.request_id) ||
			`memory_ingest:${Date.now()}`;
		const job = await this.pollIngest(jobId, stringValue(ingested.status_url));
		const jobStatus = stringValue(job.status) || stringValue(ingested.status) || "queued";
		if (jobStatus === "failed" || jobStatus === "cancelled") {
			throw new Error(
				stringValue(job.error) || `MemCode ingest ${jobStatus}.`
			);
		}
		if (jobStatus === "completed") {
			try {
				const hits = await this.search({
					query: payload.user_query.slice(0, 5_000),
					userId,
					limit: 8,
				});
				if (hits.length) return hits;
			} catch {
				// Fall through to the ingest receipt when search is not ready yet.
			}
		}
		const result = asRecord(job.result);
		const categories = stringList(result.classification);
		return [
			{
				id: jobId,
				content: payload.user_query,
				userId,
				input: input.messages,
				categories: categories.length ? categories : undefined,
				metadata: {
					...(input.metadata || {}),
					category: categories[0] || "summary",
					domain: categories[0],
					jobId,
					jobStatus,
				},
				lifecycleState: jobStatus,
				createdAt: stringValue(job.created_at) || stringValue(job.completed_at),
			},
		];
	}

	async search(query: MemorySearchQuery): Promise<MemoryRecord[]> {
		const q = query.query.trim();
		if (!q) throw new Error(getMessage().MEMORY_CONNECTOR_QUERY_REQUIRED);
		const userId = requireUserId(query.userId);
		return this.searchMemories({
			query: q,
			userId,
			limit: query.limit || 10,
			domains: [...MEMCODE_DOMAINS],
		});
	}

	async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
		const userId = requireUserId(filter.userId);
		const limit = Math.min(Math.max(filter.limit || 25, 1), 100);
		const batches = await Promise.all(
			LIST_RECALLS.map((recall) =>
				this.searchMemories({
					query: recall.query,
					userId,
					limit,
					domains: [...recall.domains],
				})
			)
		);
		const seen = new Set<string>();
		const records: MemoryRecord[] = [];
		for (const batch of batches) {
			for (const record of batch) {
				if (seen.has(record.id)) continue;
				seen.add(record.id);
				records.push(record);
			}
		}
		if (records.length) return records.slice(0, limit);
		return this.retrieveSources(userId, limit);
	}

	private async searchMemories(input: {
		query: string;
		userId: string;
		limit: number;
		domains?: string[];
	}): Promise<MemoryRecord[]> {
		const body = await this.request("v2/memory/search", {
			method: "POST",
			body: {
				query: input.query.slice(0, 5_000),
				user_id: input.userId,
				domains: input.domains?.length ? input.domains : [...MEMCODE_DOMAINS],
				memory_top_k: input.limit,
				original_top_k: Math.min(input.limit, 8),
				include_original_chunks: true,
			},
		});
		return normalizeHits(body, input.userId);
	}

	private async retrieveSources(
		userId: string,
		limit: number
	): Promise<MemoryRecord[]> {
		const body = await this.request("v2/memory/retrieve", {
			method: "POST",
			body: {
				query: LIST_RECALLS[2].query,
				user_id: userId,
				top_k: Math.min(limit, 50),
			},
		});
		return normalizeHits(body, userId).slice(0, limit);
	}

	private async pollIngest(
		jobId: string,
		statusUrl?: string
	): Promise<Record<string, unknown>> {
		const deadline = Date.now() + POLL_DEADLINE_MS;
		let delay = 200;
		let last: Record<string, unknown> = { job_id: jobId, status: "queued" };
		while (Date.now() < deadline) {
			last = unwrap(await this.request(statusPath(jobId, statusUrl)));
			const status = stringValue(last.status);
			if (status === "completed" || status === "failed" || status === "cancelled") {
				return last;
			}
			await sleep(delay);
			delay = Math.min(delay * 2, 1_200);
		}
		return last;
	}
}

export const memcodeAdapterFactory = {
	type: "memcode",
	create: (descriptor: MemorySourceDescriptor) => new MemcodeAdapter(descriptor),
	describe: (): MemoryTypeDescriptor => ({
		type: "memcode",
		displayName: "MemCode",
		description: getMessage().MEMORY_CONNECTOR_MEMCODE_DESCRIPTION,
		capabilities: { ...MEMCODE_CAPABILITIES },
		configFields: memoryHttpVendorFields({ placeholder: DEFAULT_URL }),
		filterFields: memoryPageFilters([
			{ key: "userId", required: true, writeRequired: true },
		]),
		authStyle: "api-key",
		authHelp: getMessage().MEMORY_CONNECTOR_AUTH_HELP_MEMCODE,
		docsUrl: DOCS_URL,
	}),
};
