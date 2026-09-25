/**
 * MemCode memory connector.
 *
 * Talks to Memory API v2 (`https://memory.memcode.in`): ingest, list, search,
 * graph, and retrieve. Credentials stay on the connector (`enc:v1:`) and are
 * sent as `Authorization: Bearer <apiKey>`. The API key identifies the personal
 * user, so `user_id` is never required on a request: it is forwarded only when
 * an operator pins one from the Memory page filters.
 *
 * MemCode is the only memory connector with a first-class graph endpoint, so it
 * implements the optional `graph()` port. Every other connector still has its
 * graph derived from list records by `buildMemoryGraph`.
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
import { classifyMemoryKind } from "../graph";
import type {
	MemoryGraphEdge,
	MemoryGraphModel,
	MemoryGraphNode,
} from "../graph";
import type {
	MemoryCapabilities,
	MemoryGraphFilter,
	MemoryListFilter,
	MemoryListPage,
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
/** `GET /v2/memory` caps `limit` at 500, so this is the page size, not a total. */
const LIST_PAGE_MAX = 500;
/** Upper bound on how many memories one list call will page through. */
const LIST_RECORD_MAX = 10_000;
/**
 * `GET /v2/memory-graph` caps `limit` at 5000 and `edge_limit` at 50000. The
 * Memory page renders once rather than progressively, so it asks for the whole
 * budget per request instead of the small pages the MemCode dashboard streams.
 */
const GRAPH_NODE_PAGE = 5_000;
const GRAPH_EDGE_PAGE = 10_000;
const GRAPH_NODE_MAX = 5_000;
const GRAPH_EDGE_MAX = 20_000;
const GRAPH_PAGE_LIMIT = 12;
/**
 * How many memories are drawn, near the dashboard's 500-node first page. Past
 * this the squares fit the panel at roughly a pixel each and the connections
 * stop being visible, which is the whole point of the view. Edges are still
 * discovered across the full node budget above; a memory with no connection
 * tells the graph nothing the list tab does not already show, so connected
 * memories are kept first and isolated ones fill what is left.
 */
const GRAPH_RENDER_MAX = 600;
const POLL_DEADLINE_MS = 8_000;
/**
 * Purpose-built credential check: 200 only when the key maps to an account.
 * It reports the account's identity too, which this connector does not need.
 */
const CREDENTIAL_TEST_PATH = "v2/test";

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

/**
 * MemCode resolves the personal user from the API key, so a pinned user id is
 * an optional narrowing rather than a requirement.
 */
function optionalUserId(userId?: string): string | undefined {
	return userId?.trim() || undefined;
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
	if (row.content_complete === false) {
		metadata.content_complete = false;
	}
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

function listPageItems(data: Record<string, unknown>): unknown[] {
	if (Array.isArray(data.items)) return data.items;
	if (Array.isArray(data.memories)) return data.memories;
	return [];
}

function normalizeListPage(
	raw: unknown,
	ctx: { userId?: string; offset: number }
): MemoryListPage {
	const data = unwrap(raw);
	const items = listPageItems(data);
	const records = items
		.map((item, index) => normalizeRecord(item, { userId: ctx.userId, index }))
		.filter((record): record is MemoryRecord => !!record);
	const offset = numberValue(data.offset) ?? ctx.offset;
	const total = numberValue(data.total_memories);
	const hasMore =
		data.has_more === true ||
		(total !== undefined && offset + items.length < total);
	return { records, total, hasMore, nextOffset: offset + items.length };
}

function ingestPayload(input: MemoryWriteInput, userId?: string) {
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
		...(userId ? { user_id: userId } : {}),
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

/**
 * `GET /v2/memory-graph` returns memory nodes keyed by the same public memory id
 * the list route uses, so a node click can open the memory detail sheet. The
 * node `type` is the memory domain; edges carry a 0-1 connection `weight`.
 */
function normalizeGraphNode(raw: unknown): MemoryGraphNode | null {
	const row = asRecord(raw);
	const id = stringValue(row.id);
	if (!id) return null;
	const domain = stringValue(row.type) || "summary";
	const metadata = objectValue(row.metadata) || {};
	const content = stringValue(metadata.content) || "";
	const label = stringValue(row.label) || content || id;
	return {
		id,
		type: "memory",
		label: label.length > 64 ? `${label.slice(0, 61).trimEnd()}…` : label,
		memoryId: id,
		kind: classifyMemoryKind({
			id,
			content,
			categories: [domain],
			metadata: { domain },
		}),
		// MemCode has no get-by-id route and the graph spans far more memories
		// than one list page, so the node carries what the detail sheet needs.
		domain,
		content: content || undefined,
		createdAt: stringValue(metadata.created_at),
		updatedAt: stringValue(metadata.updated_at),
	};
}

function normalizeGraphEdge(raw: unknown): MemoryGraphEdge | null {
	const row = asRecord(raw);
	const from = stringValue(row.source);
	const to = stringValue(row.target);
	if (!from || !to || from === to) return null;
	const weight = numberValue(row.weight) ?? numberValue(row.strength);
	const domain = stringValue(row.domain);
	return {
		from,
		to,
		label: stringValue(row.type),
		domain,
		weight:
			weight === undefined ? undefined : Math.min(1, Math.max(0, weight)),
	};
}

function edgeKey(edge: MemoryGraphEdge): string {
	return JSON.stringify([edge.domain || "", edge.from, edge.to, edge.label || ""]);
}

function renderableNodes(
	nodes: Map<string, MemoryGraphNode>,
	edges: MemoryGraphEdge[]
): MemoryGraphNode[] {
	if (nodes.size <= GRAPH_RENDER_MAX) return Array.from(nodes.values());
	const connected = new Set<string>();
	for (const edge of edges) {
		connected.add(edge.from);
		connected.add(edge.to);
	}
	const kept: MemoryGraphNode[] = [];
	const isolated: MemoryGraphNode[] = [];
	for (const node of Array.from(nodes.values())) {
		if (connected.has(node.id)) kept.push(node);
		else isolated.push(node);
	}
	if (kept.length >= GRAPH_RENDER_MAX) return kept.slice(0, GRAPH_RENDER_MAX);
	return kept.concat(isolated.slice(0, GRAPH_RENDER_MAX - kept.length));
}

function clampCount(value: number | undefined, fallback: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(1, Math.floor(value)));
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

	/**
	 * Test connection in two cheap steps.
	 *
	 * `GET /health` proves the URL really is a Memory API and that its pipelines
	 * are up. It is unauthenticated, so it can never stand alone: with a bad key
	 * it still answers 200.
	 * `GET /v2/test` then checks the credential itself: it answers 200 only when
	 * the key maps to a live account, and 401/403 otherwise. Listing is not used
	 * as a probe — a `limit=1` list still materialises every memory in the
	 * account server-side before it slices the page.
	 */
	async healthCheck(): Promise<ConnectorHealthResult> {
		const started = Date.now();
		const latencyMs = () => Date.now() - started;
		const messages = getMessage();

		// Decisive: /health ships with every deployment of the Memory API, so a
		// URL that cannot answer it is not a Memory API. Without this the
		// credential probe below would read any host's blanket 404 as success.
		try {
			const health = unwrap(await this.request("health", { timeoutMs: 10_000 }));
			const state = stringValue(health.status);
			if (health.pipelines_ready !== true && state !== "ready") {
				return {
					ok: false,
					latencyMs: latencyMs(),
					message: state
						? messages.MEMORY_CONNECTOR_MEMCODE_NOT_READY
						: messages.MEMORY_CONNECTOR_MEMCODE_NOT_FOUND,
				};
			}
		} catch (error) {
			const status = error instanceof SourceResponseError ? error.status : undefined;
			return {
				ok: false,
				latencyMs: latencyMs(),
				message:
					status === 503
						? messages.MEMORY_CONNECTOR_MEMCODE_NOT_READY
						: status === 404
							? messages.MEMORY_CONNECTOR_MEMCODE_NOT_FOUND
							: String((error as Error)?.message || error),
			};
		}

		try {
			await this.request(CREDENTIAL_TEST_PATH, { timeoutMs: 10_000 });
			return { ok: true, latencyMs: latencyMs() };
		} catch (error) {
			const status = error instanceof SourceResponseError ? error.status : undefined;
			// 429 means the credential was accepted and then throttled.
			if (status === 429) {
				return { ok: true, latencyMs: latencyMs() };
			}
			// /health already proved this is a Memory API, so a 404 here means the
			// deployment predates the credential-test route rather than a bad URL.
			if (status === 404) {
				return {
					ok: false,
					latencyMs: latencyMs(),
					message: messages.MEMORY_CONNECTOR_MEMCODE_NO_TEST_ROUTE,
				};
			}
			if (status === 401 || status === 403) {
				return {
					ok: false,
					latencyMs: latencyMs(),
					message: messages.MEMORY_CONNECTOR_MEMCODE_KEY_REJECTED,
				};
			}
			if (status === 402) {
				return {
					ok: false,
					latencyMs: latencyMs(),
					message: messages.MEMORY_CONNECTOR_MEMCODE_PAYMENT_REQUIRED,
				};
			}
			return {
				ok: false,
				latencyMs: latencyMs(),
				message: String((error as Error)?.message || error),
			};
		}
	}

	async add(input: MemoryWriteInput): Promise<MemoryRecord[]> {
		const userId = optionalUserId(input.userId);
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
		return this.searchMemories({
			query: q,
			userId: optionalUserId(query.userId),
			limit: query.limit || 10,
			domains: [...MEMCODE_DOMAINS],
		});
	}

	/**
	 * One server page, so callers can paginate with a durable `total_memories`
	 * instead of re-reading from offset 0.
	 */
	async listPage(filter: MemoryListFilter): Promise<MemoryListPage> {
		const offset = Math.max(0, Math.floor(filter.offset || 0));
		const params = new URLSearchParams({
			limit: String(clampCount(filter.limit, 100, LIST_PAGE_MAX)),
			offset: String(offset),
		});
		return normalizeListPage(
			await this.request(`v2/memory?${params.toString()}`),
			{ userId: optionalUserId(filter.userId), offset }
		);
	}

	async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
		const wanted = clampCount(filter.limit, 100, LIST_RECORD_MAX);
		const records: MemoryRecord[] = [];
		let offset = Math.max(0, Math.floor(filter.offset || 0));
		while (records.length < wanted) {
			const page = await this.listPage({
				...filter,
				limit: Math.min(wanted - records.length, LIST_PAGE_MAX),
				offset,
			});
			records.push(...page.records);
			if (!page.hasMore || page.records.length === 0) break;
			if (page.nextOffset <= offset) break;
			offset = page.nextOffset;
		}
		return records.slice(0, wanted);
	}

	/**
	 * Page `GET /v2/memory-graph` into the shared graph model. The API exhausts
	 * the edges incident to the current node page before advancing the node
	 * cursor, so both cursors are followed the way the MemCode dashboard does.
	 */
	async graph(options: MemoryGraphFilter = {}): Promise<MemoryGraphModel> {
		const maxNodes = clampCount(options.maxNodes, GRAPH_NODE_MAX, GRAPH_NODE_MAX);
		const maxEdges = clampCount(options.maxEdges, GRAPH_EDGE_MAX, GRAPH_EDGE_MAX);
		const nodes = new Map<string, MemoryGraphNode>();
		const edges = new Map<string, MemoryGraphEdge>();
		const domains = new Set<string>();
		let totalMemories = 0;
		let offset = 0;
		let edgeOffset = 0;
		let truncated = false;
		// Page sizes stay fixed: the node window must not change while its edge
		// cursor is being drained, or the next page describes a different window.
		const nodePage = Math.min(GRAPH_NODE_PAGE, maxNodes);
		const edgePage = Math.min(GRAPH_EDGE_PAGE, maxEdges);

		for (let page = 0; page < GRAPH_PAGE_LIMIT; page += 1) {
			const params = new URLSearchParams({
				limit: String(nodePage),
				offset: String(offset),
				edge_limit: String(edgePage),
				edge_offset: String(edgeOffset),
			});
			const data = unwrap(await this.request(`v2/memory-graph?${params.toString()}`));
			const pageNodes = Array.isArray(data.nodes) ? data.nodes : [];
			const pageEdges = Array.isArray(data.edges) ? data.edges : [];
			for (const raw of pageNodes) {
				const node = normalizeGraphNode(raw);
				if (node && !nodes.has(node.id)) nodes.set(node.id, node);
			}
			for (const raw of pageEdges) {
				const edge = normalizeGraphEdge(raw);
				if (edge) edges.set(edgeKey(edge), edge);
			}
			for (const domain of stringList(data.domains)) domains.add(domain);
			totalMemories = Math.max(
				totalMemories,
				numberValue(data.total_memories) ?? 0,
				nodes.size
			);

			if (nodes.size >= maxNodes || edges.size >= maxEdges) {
				truncated = data.has_more === true || data.has_more_edges === true;
				break;
			}
			// Edges first: the node cursor only advances once this page's edges
			// are drained, matching the API's pagination contract.
			if (data.has_more_edges === true && pageEdges.length > 0) {
				edgeOffset = (numberValue(data.edge_offset) ?? edgeOffset) + pageEdges.length;
				continue;
			}
			if (data.has_more === true && pageNodes.length > 0) {
				offset = (numberValue(data.offset) ?? offset) + pageNodes.length;
				edgeOffset = 0;
				continue;
			}
			truncated = data.has_more === true || data.has_more_edges === true;
			break;
		}

		// An edge may name an endpoint delivered on a page we never asked for;
		// drop it rather than draw a connection into nothing.
		const edgeList = Array.from(edges.values()).filter(
			(edge) => nodes.has(edge.from) && nodes.has(edge.to)
		);
		const rendered = renderableNodes(nodes, edgeList);
		const renderedIds = new Set(rendered.map((node) => node.id));
		const renderedEdges =
			rendered.length === nodes.size
				? edgeList
				: edgeList.filter(
						(edge) => renderedIds.has(edge.from) && renderedIds.has(edge.to)
					);
		return {
			nodes: rendered,
			edges: renderedEdges,
			kind: "knowledge",
			weighted:
				renderedEdges.length > 0 &&
				renderedEdges.every((edge) => edge.weight !== undefined),
			totalMemories,
			domains: Array.from(domains).sort(),
			truncated: truncated || rendered.length < nodes.size,
		};
	}

	private async searchMemories(input: {
		query: string;
		userId?: string;
		limit: number;
		domains?: string[];
	}): Promise<MemoryRecord[]> {
		const body = await this.request("v2/memory/search", {
			method: "POST",
			body: {
				query: input.query.slice(0, 5_000),
				...(input.userId ? { user_id: input.userId } : {}),
				domains: input.domains?.length ? input.domains : [...MEMCODE_DOMAINS],
				memory_top_k: input.limit,
				original_top_k: Math.min(input.limit, 8),
				include_original_chunks: true,
			},
		});
		return normalizeHits(body, input.userId);
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
		// No page filters: the API key is the tenant. Memory API v2 resolves the
		// personal user from the credential and discards any `user_id` a client
		// sends (it is honoured only for a local static dev key), so a user
		// control here could neither narrow a read nor redirect a write.
		filterFields: memoryPageFilters([]),
		// v2 has no get-by-id route; a list or graph record is already everything
		// the API can return for a memory, so the detail sheet needs no caveat.
		detailFromList: true,
		authStyle: "api-key",
		authHelp: getMessage().MEMORY_CONNECTOR_AUTH_HELP_MEMCODE,
		docsUrl: DOCS_URL,
	}),
};
