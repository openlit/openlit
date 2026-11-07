/**
 * Cognee memory connector.
 *
 * Talks to the Cognee REST API (Cognee Cloud or a self-hosted server). Cognee
 * keeps memory in datasets: `add` stores a document and starts building the
 * dataset's knowledge graph, `search` runs a chunk (vector) search, and the
 * dataset's graph is read back from its own `/graph` route. A Cognee "dataset"
 * is the scope of every call, so it is exposed as the session filter.
 *
 * Cognee stores documents, not rows with text: `list` can only show a
 * document's name and metadata (the text lives in a raw file), so `get` reads
 * the file for the full text. Memory ids are `<datasetId>:<dataId>` because
 * `get`, `update`, and `delete` are all dataset-scoped. There is no per-memory
 * feedback route, so `feedback` stays unsupported.
 */

import { createHash, randomUUID } from "crypto";
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
import { classifyEntityType } from "../graph";
import type {
	MemoryGraphEdge,
	MemoryGraphModel,
	MemoryGraphNode,
} from "../graph";
import { memoryBaseUrl, memoryRequest } from "../http";
import type {
	MemoryCapabilities,
	MemoryFilterOptions,
	MemoryGraphFilter,
	MemoryListFilter,
	MemoryListPage,
	MemoryRecord,
	MemorySearchQuery,
	MemorySourceDescriptor,
	MemoryTypeDescriptor,
	MemoryUpdateInput,
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

const URL_PLACEHOLDER = "http://localhost:8000";
const DOCS_URL = "https://docs.cognee.ai/api-reference/introduction";
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 10;
/** `GET /datasets/{id}/data` rejects a `limit` above 1000. */
const DATA_PAGE_MAX = 1000;
/** `get` has no by-id route, so it pages the dataset; stop after this many pages. */
const DATA_LOOKUP_PAGES = 20;
const ADD_TIMEOUT_MS = 60_000;
/** An update re-ingests the document and rebuilds its graph before answering. */
const UPDATE_TIMEOUT_MS = 120_000;
/** The force layout is O(nodes^2); keep the drawn graph within a safe budget. */
const GRAPH_NODE_MAX = 600;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Cognee node types that stand for one stored document. */
const DOCUMENT_NODE_TYPES = new Set([
	"textdocument",
	"pdfdocument",
	"imagedocument",
	"audiodocument",
	"csvdocument",
	"unstructureddocument",
	"document",
]);
const CHUNK_NODE_TYPE = "documentchunk";

const COGNEE_CAPABILITIES: MemoryCapabilities = {
	add: true,
	search: true,
	get: true,
	list: true,
	update: true,
	delete: true,
	feedback: false,
};

interface DatasetRef {
	id: string;
	name: string;
}

interface DataRow {
	id: string;
	name?: string;
	mimeType?: string;
	record: MemoryRecord;
}

function isUuid(value: string): boolean {
	return UUID_PATTERN.test(value);
}

/** Dataset and data ids are both needed to address a document. */
function encodeMemoryRef(datasetId: string, dataId: string): string {
	return `${datasetId}:${dataId}`;
}

function parseMemoryRef(
	id: string
): { datasetId: string; dataId: string } | null {
	const [datasetId, dataId, ...rest] = id.trim().split(":");
	if (rest.length || !datasetId || !dataId) return null;
	if (!isUuid(datasetId) || !isUuid(dataId)) return null;
	return { datasetId: datasetId.toLowerCase(), dataId: dataId.toLowerCase() };
}

function isTextMime(mimeType: string | undefined): boolean {
	return !!mimeType && /^text\/|^application\/json$/i.test(mimeType);
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** `node_set` is reserved by Cognee's ingestion and rejected when sent as metadata. */
function writableMetadata(
	metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
	if (!metadata) return undefined;
	const { node_set: _reserved, ...rest } = metadata;
	return Object.keys(rest).length ? rest : undefined;
}

function field(row: Record<string, unknown>, camel: string, snake: string): unknown {
	return row[camel] ?? row[snake];
}

/** One `DataDTO` row from `GET /datasets/{id}/data` (camelCase on the wire). */
function normalizeDataRow(raw: unknown, datasetId: string): DataRow | null {
	const row = asRecord(raw);
	const dataId = stringValue(row.id);
	if (!dataId) return null;
	const name = stringValue(row.name);
	const label = stringValue(row.label);
	const mimeType = stringValue(field(row, "mimeType", "mime_type"));
	const extension = stringValue(row.extension);
	const dataSize = numberValue(field(row, "dataSize", "data_size"));
	const contentHash = stringValue(field(row, "contentHash", "content_hash"));
	const external = asRecord(field(row, "externalMetadata", "external_metadata"));
	return {
		id: dataId,
		name,
		mimeType,
		record: {
			id: encodeMemoryRef(datasetId, dataId),
			content: name || dataId,
			sessionId: datasetId,
			categories: label ? [label] : undefined,
			metadata: {
				...external,
				...(mimeType ? { mime_type: mimeType } : {}),
				...(extension ? { extension } : {}),
				...(dataSize !== undefined ? { data_size: dataSize } : {}),
				...(contentHash ? { content_hash: contentHash } : {}),
			},
			createdAt: stringValue(field(row, "createdAt", "created_at")),
			updatedAt: stringValue(field(row, "updatedAt", "updated_at")),
		},
	};
}

/**
 * `POST /search` answers `[{dataset_id, search_result: [...]}]` when backend
 * access control is on and a bare list of results when it is off. Either way,
 * the hits themselves are the objects that carry a `text`.
 */
function chunksFrom(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) return value.flatMap(chunksFrom);
	const row = asRecord(value);
	if (Array.isArray(row.search_result)) return chunksFrom(row.search_result);
	return typeof row.text === "string" ? [row] : [];
}

/**
 * A document is split into chunks, so several hits can belong to one document.
 * They are merged under the document's id, in relevance order. Cognee reports
 * a raw distance rather than a similarity, so no `score` is set.
 */
function normalizeChunks(raw: unknown, datasetId: string): MemoryRecord[] {
	const merged = new Map<string, MemoryRecord>();
	for (const chunk of chunksFrom(raw)) {
		const text = stringValue(chunk.text);
		if (!text) continue;
		const documentId = stringValue(chunk.document_id);
		const chunkId = stringValue(chunk.id);
		const sourceId = documentId || chunkId;
		if (!sourceId) continue;
		const id = encodeMemoryRef(datasetId, sourceId);
		const existing = merged.get(id);
		if (existing) {
			existing.content = `${existing.content}\n\n${text}`;
			continue;
		}
		const documentName = stringValue(chunk.document_name);
		merged.set(id, {
			id,
			content: text,
			sessionId: datasetId,
			metadata: {
				...(documentName ? { document_name: documentName } : {}),
				...(chunkId ? { chunk_id: chunkId } : {}),
			},
		});
	}
	return Array.from(merged.values());
}

function multipartText(boundary: string, filename: string, text: string): string {
	return [
		`--${boundary}`,
		`Content-Disposition: form-data; name="data"; filename="${filename}"`,
		"Content-Type: text/plain; charset=utf-8",
		"",
		text,
		`--${boundary}--`,
		"",
	].join("\r\n");
}

/**
 * Project Cognee's whole-dataset graph onto what the Memory page draws. A
 * document node is a memory, so clicking it opens the document. Chunks are an
 * implementation detail of retrieval and would drown the graph, so edges that
 * touch a chunk are re-pointed at the chunk's document.
 */
function normalizeGraph(raw: unknown, datasetId: string, maxNodes: number): MemoryGraphModel {
	const body = asRecord(raw);
	const rawNodes = Array.isArray(body.nodes) ? body.nodes : [];
	const rawEdges = Array.isArray(body.edges) ? body.edges : [];

	const typeById = new Map<string, string>();
	const nodes = new Map<string, MemoryGraphNode>();
	for (const item of rawNodes) {
		const row = asRecord(item);
		const id = stringValue(row.id);
		if (!id) continue;
		const type = stringValue(row.type) || "Entity";
		typeById.set(id, type.toLowerCase());
		if (type.toLowerCase() === CHUNK_NODE_TYPE) continue;
		const label = stringValue(row.label) || id;
		const isDocument = DOCUMENT_NODE_TYPES.has(type.toLowerCase());
		const entityType = classifyEntityType([type]);
		nodes.set(id, {
			id,
			type: isDocument ? "memory" : entityType === "user" ? "user" : "entity",
			label: label.length > 64 ? `${label.slice(0, 61).trimEnd()}…` : label,
			...(isDocument
				? { memoryId: encodeMemoryRef(datasetId, id), kind: "summary" as const }
				: { entityType }),
			domain: type,
		});
	}

	const chunkDocument = new Map<string, string>();
	for (const item of rawEdges) {
		const row = asRecord(item);
		const from = stringValue(row.source);
		const to = stringValue(row.target);
		if (!from || !to || typeById.get(from) !== CHUNK_NODE_TYPE) continue;
		if (DOCUMENT_NODE_TYPES.has(typeById.get(to) || "")) chunkDocument.set(from, to);
	}

	const edges = new Map<string, MemoryGraphEdge>();
	for (const item of rawEdges) {
		const row = asRecord(item);
		const source = stringValue(row.source);
		const target = stringValue(row.target);
		if (!source || !target) continue;
		const from = chunkDocument.get(source) ?? source;
		const to = chunkDocument.get(target) ?? target;
		if (from === to || !nodes.has(from) || !nodes.has(to)) continue;
		const label = stringValue(row.label);
		edges.set(JSON.stringify([from, to, label || ""]), { from, to, label });
	}

	const degree = new Map<string, number>();
	for (const edge of Array.from(edges.values())) {
		degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
		degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
	}
	const totalMemories = Array.from(nodes.values()).filter(
		(node) => node.type === "memory"
	).length;
	const ranked = Array.from(nodes.values()).sort(
		(a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0)
	);
	const kept = ranked.slice(0, maxNodes);
	const keptIds = new Set(kept.map((node) => node.id));
	const keptEdges = Array.from(edges.values()).filter(
		(edge) => keptIds.has(edge.from) && keptIds.has(edge.to)
	);
	return {
		nodes: kept,
		edges: keptEdges,
		kind: "knowledge",
		totalMemories,
		truncated: kept.length < nodes.size,
	};
}

/** Thrown when a by-id lookup would need to scan more of a dataset than is reasonable. */
export class CogneeLookupLimitError extends Error {
	constructor() {
		super(getMessage().MEMORY_CONNECTOR_COGNEE_LOOKUP_LIMIT);
		this.name = "CogneeLookupLimitError";
	}
}

export class CogneeAdapter extends BaseMemoryAdapter {
	readonly type = "cognee";

	private get baseUrl(): string {
		const url = memoryBaseUrl(this.descriptor, "");
		if (!url) throw new Error(getMessage().MEMORY_CONNECTOR_COGNEE_URL_REQUIRED);
		return url;
	}

	private request<T>(
		path: string,
		opts: {
			method?: string;
			body?: unknown;
			rawBody?: string;
			headers?: Record<string, string>;
			timeoutMs?: number;
			retry?: boolean;
		} = {}
	) {
		return memoryRequest<T>(this.descriptor, this.baseUrl, path, {
			...opts,
			authHeaders: (secret: ResolvedSecret): Record<string, string> => {
				const apiKey = secret.credentials.apiKey || secret.raw;
				return apiKey ? { "X-Api-Key": apiKey } : {};
			},
		});
	}

	capabilities(): MemoryCapabilities {
		return { ...COGNEE_CAPABILITIES };
	}

	/** `/health` is unauthenticated, so list datasets to prove the credential. */
	async healthCheck(): Promise<ConnectorHealthResult> {
		const started = Date.now();
		try {
			await this.request("api/v1/datasets", { timeoutMs: 10_000 });
			return { ok: true, latencyMs: Date.now() - started };
		} catch (error) {
			const messages = getMessage();
			const status = error instanceof SourceResponseError ? error.status : undefined;
			return {
				ok: false,
				latencyMs: Date.now() - started,
				message:
					status === 401 || status === 403
						? messages.MEMORY_CONNECTOR_COGNEE_AUTH_FAILED
						: status === 404
							? messages.MEMORY_CONNECTOR_COGNEE_API_NOT_FOUND
							: String((error as Error)?.message || error),
			};
		}
	}

	private async datasets(): Promise<DatasetRef[]> {
		const rows = requireArray(
			await this.request("api/v1/datasets"),
			getMessage().MEMORY_CONNECTOR_BAD_RESPONSE
		);
		const refs: DatasetRef[] = [];
		for (const item of rows) {
			const row = asRecord(item);
			const id = stringValue(row.id);
			if (id) refs.push({ id: id.toLowerCase(), name: stringValue(row.name) || id });
		}
		return refs;
	}

	/** The dataset filter holds a name (typed) or an id (listed); routes need the id. */
	private async datasetId(scope: string | undefined): Promise<string> {
		const messages = getMessage();
		const value = scope?.trim();
		if (!value) throw new Error(messages.MEMORY_CONNECTOR_SESSION_REQUIRED);
		if (isUuid(value)) return value.toLowerCase();
		const match = (await this.datasets()).find((dataset) => dataset.name === value);
		if (!match) throw new Error(messages.MEMORY_CONNECTOR_COGNEE_DATASET_NOT_FOUND);
		return match.id;
	}

	async listFilters(): Promise<MemoryFilterOptions> {
		const filters = emptyMemoryFilters();
		try {
			filters.sessions = uniqueChoices(
				(await this.datasets()).map((dataset) => ({
					id: dataset.id,
					label: dataset.name,
				}))
			);
		} catch {
			filters.sessions = [];
		}
		return filters;
	}

	private async dataPage(
		datasetId: string,
		limit: number,
		offset: number
	): Promise<DataRow[]> {
		const params = new URLSearchParams({
			limit: String(limit),
			offset: String(offset),
		});
		const rows = requireArray(
			await this.request(`api/v1/datasets/${datasetId}/data?${params.toString()}`),
			getMessage().MEMORY_CONNECTOR_BAD_RESPONSE
		);
		return rows
			.map((row) => normalizeDataRow(row, datasetId))
			.filter((row): row is DataRow => !!row);
	}

	private async findRow(datasetId: string, dataId: string): Promise<DataRow | null> {
		for (let page = 0; page < DATA_LOOKUP_PAGES; page += 1) {
			const rows = await this.dataPage(datasetId, DATA_PAGE_MAX, page * DATA_PAGE_MAX);
			const match = rows.find((row) => row.id.toLowerCase() === dataId);
			if (match) return match;
			if (rows.length < DATA_PAGE_MAX) return null;
		}
		// Cognee has no by-id route: a miss past the cap is unknown, not "absent".
		throw new CogneeLookupLimitError();
	}

	/** Cognee dedups by the MD5 of the stored text, which also finds the row again. */
	private async dataIdsForText(datasetId: string, text: string): Promise<string[]> {
		const hash = createHash("md5").update(text, "utf8").digest("hex");
		const params = new URLSearchParams({ content_hash: hash, limit: "10" });
		const rows = requireArray(
			await this.request(`api/v1/datasets/${datasetId}/data?${params.toString()}`),
			getMessage().MEMORY_CONNECTOR_BAD_RESPONSE
		);
		return rows
			.map((row) => stringValue(asRecord(row).id))
			.filter((id): id is string => !!id);
	}

	async add(input: MemoryWriteInput): Promise<MemoryRecord[]> {
		const messages = getMessage();
		const text = writeContent(input);
		if (!text) throw new Error(messages.MEMORY_CONNECTOR_CONTENT_REQUIRED);
		const scope = input.sessionId?.trim();
		if (!scope) throw new Error(messages.MEMORY_CONNECTOR_SESSION_REQUIRED);

		const form = new URLSearchParams();
		form.append("raw_data", text);
		// A typed name creates the dataset on first write; a listed id must exist.
		form.set(isUuid(scope) ? "datasetId" : "datasetName", scope);
		const metadata = writableMetadata(input.metadata);
		if (metadata) form.set("external_metadata", JSON.stringify([metadata]));
		const run = requireObject(
			await this.request("api/v1/add", {
				method: "POST",
				rawBody: form.toString(),
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				timeoutMs: ADD_TIMEOUT_MS,
				retry: false,
			}),
			messages.MEMORY_CONNECTOR_BAD_RESPONSE
		);
		const datasetId = stringValue(run.dataset_id ?? run.datasetId)?.toLowerCase();
		if (!datasetId) throw new Error(messages.MEMORY_CONNECTOR_BAD_RESPONSE);
		let dataIds = Array.isArray(run.data_ids)
			? run.data_ids.map((id) => stringValue(id)).filter((id): id is string => !!id)
			: [];
		if (!dataIds.length) dataIds = await this.dataIdsForText(datasetId, text);
		if (!dataIds.length) throw new Error(messages.MEMORY_CONNECTOR_BAD_RESPONSE);

		// The document is stored; building the graph is a second, long-running
		// call. A failure there must not hide the stored document or invite a
		// duplicate write, so it is reported on the record instead.
		let graph: Record<string, unknown> = { graph: "building" };
		try {
			await this.request("api/v1/cognify", {
				method: "POST",
				body: { dataset_ids: [datasetId], run_in_background: true },
				retry: false,
			});
		} catch (error) {
			graph = {
				graph: "failed",
				error: messages.MEMORY_CONNECTOR_COGNEE_COGNIFY_FAILED(
					String((error as Error)?.message || error)
				),
			};
		}
		return dataIds.map((dataId) => ({
			id: encodeMemoryRef(datasetId, dataId.toLowerCase()),
			content: text,
			sessionId: datasetId,
			metadata: { ...metadata, cognee: graph },
		}));
	}

	async search(query: MemorySearchQuery): Promise<MemoryRecord[]> {
		const messages = getMessage();
		const q = query.query.trim();
		if (!q) throw new Error(messages.MEMORY_CONNECTOR_QUERY_REQUIRED);
		const datasetId = await this.datasetId(query.sessionId);
		const limit = query.limit || DEFAULT_SEARCH_LIMIT;
		// CHUNKS is a pure vector search: it returns the stored passages and
		// never calls an LLM, unlike the completion search types.
		const body = await this.request("api/v1/search", {
			method: "POST",
			body: {
				search_type: "CHUNKS",
				query: q,
				dataset_ids: [datasetId],
				top_k: limit,
			},
		});
		requireArray(body, messages.MEMORY_CONNECTOR_BAD_RESPONSE);
		return normalizeChunks(body, datasetId).slice(0, limit);
	}

	async listPage(filter: MemoryListFilter): Promise<MemoryListPage> {
		const datasetId = await this.datasetId(filter.sessionId);
		const limit = Math.min(
			DATA_PAGE_MAX,
			Math.max(1, Math.floor(filter.limit || DEFAULT_LIST_LIMIT))
		);
		const offset = Math.max(0, Math.floor(filter.offset || 0));
		const [rows, total] = await Promise.all([
			this.dataPage(datasetId, limit, offset),
			this.request(`api/v1/datasets/${datasetId}/data/count`)
				.then((body) => numberValue(asRecord(body).count))
				.catch(() => undefined),
		]);
		return {
			records: rows.map((row) => row.record),
			total,
			hasMore:
				total !== undefined ? offset + rows.length < total : rows.length === limit,
			nextOffset: offset + rows.length,
		};
	}

	async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
		return (await this.listPage(filter)).records;
	}

	async get(id: string): Promise<MemoryRecord | null> {
		const ref = parseMemoryRef(id);
		if (!ref) return null;
		let row: DataRow | null;
		try {
			row = await this.findRow(ref.datasetId, ref.dataId);
		} catch (error) {
			if (error instanceof SourceResponseError && error.status === 404) return null;
			throw error;
		}
		if (!row) return null;
		if (!isTextMime(row.mimeType)) return row.record;
		// Cognee returns the raw file; the shared fetch parses JSON-looking text,
		// so a non-string body is turned back into text.
		const raw = await this.request<unknown>(
			`api/v1/datasets/${ref.datasetId}/data/${ref.dataId}/raw`
		);
		const text = typeof raw === "string" ? raw : JSON.stringify(raw);
		return { ...row.record, content: text.trim() || row.record.content };
	}

	async update(id: string, input: MemoryUpdateInput): Promise<MemoryRecord> {
		const messages = getMessage();
		const ref = parseMemoryRef(id);
		if (!ref) throw new Error(messages.MEMORY_DETAIL_NOT_FOUND);
		const text = input.content.trim();
		if (!text) throw new Error(messages.MEMORY_CONNECTOR_CONTENT_REQUIRED);
		let boundary = `openlit-${randomUUID()}`;
		while (text.includes(boundary)) boundary = `openlit-${randomUUID()}`;
		const params = new URLSearchParams({
			data_id: ref.dataId,
			dataset_id: ref.datasetId,
		});
		const result = asRecord(
			await this.request(`api/v1/update?${params.toString()}`, {
				method: "PATCH",
				rawBody: multipartText(boundary, "memory.txt", text),
				headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
				timeoutMs: UPDATE_TIMEOUT_MS,
				retry: false,
			})
		);
		if (stringValue(result.status) === "failed") {
			const failure = asRecord(result.error);
			throw new Error(
				stringValue(failure.message) || messages.MEMORY_CONNECTOR_BAD_RESPONSE
			);
		}
		// The document keeps its data id; Cognee has no document-level metadata
		// update, so only the text changes.
		return { id, content: text, sessionId: ref.datasetId };
	}

	async delete(id: string): Promise<void> {
		const messages = getMessage();
		const ref = parseMemoryRef(id);
		if (!ref) throw new Error(messages.MEMORY_DETAIL_NOT_FOUND);
		const receipt = asRecord(
			await this.request(`api/v1/datasets/${ref.datasetId}/data/${ref.dataId}`, {
				method: "DELETE",
				retry: false,
			})
		);
		// Deleting is idempotent, so a missing id is a 200 with this status.
		if (stringValue(receipt.status) === "not_found") {
			throw new Error(messages.MEMORY_DETAIL_NOT_FOUND);
		}
	}

	async graph(options: MemoryGraphFilter = {}): Promise<MemoryGraphModel> {
		const datasetId = await this.datasetId(options.sessionId);
		const maxNodes = Math.min(GRAPH_NODE_MAX, Math.max(1, options.maxNodes || GRAPH_NODE_MAX));
		const body = requireObject(
			await this.request(`api/v1/datasets/${datasetId}/graph`),
			getMessage().MEMORY_CONNECTOR_BAD_RESPONSE
		);
		return normalizeGraph(body, datasetId, maxNodes);
	}
}

export const cogneeAdapterFactory = {
	type: "cognee",
	create: (descriptor: MemorySourceDescriptor) => new CogneeAdapter(descriptor),
	describe: (): MemoryTypeDescriptor => {
		const messages = getMessage();
		return {
			type: "cognee",
			displayName: "Cognee",
			description: messages.MEMORY_CONNECTOR_COGNEE_DESCRIPTION,
			capabilities: { ...COGNEE_CAPABILITIES },
			configFields: [
				endpointField(URL_PLACEHOLDER),
				allowHttpField(),
				allowPrivateNetworkField(),
				{
					...memoryApiKeyField(),
					description: messages.MEMORY_CONNECTOR_COGNEE_API_KEY_HELP,
				},
			],
			filterFields: memoryPageFilters([
				{
					key: "sessionId",
					label: messages.MEMORY_CONNECTOR_FIELD_DATASET,
					required: true,
				},
			]),
			authStyle: "api-key",
			authHelp: messages.MEMORY_CONNECTOR_AUTH_HELP_COGNEE,
			docsUrl: DOCS_URL,
		};
	},
};
