export const AGENT_LOOP_THRESHOLD = 3;

export type AgentLoopHit = {
	toolName: string;
	count: number;
	wastedTokens: number;
	wastedCost: number;
};

export type AgentLoopGroup = AgentLoopHit & {
	groupKey: string;
	fingerprint: string;
	traceIds: string[];
};

export type AgentLoopSpan = {
	traceId?: string;
	TraceId?: string;
	timestamp?: string;
	Timestamp?: string;
	spanAttributes?: Record<string, unknown>;
	resourceAttributes?: Record<string, unknown>;
	SpanAttributes?: Record<string, unknown>;
	ResourceAttributes?: Record<string, unknown>;
};

const CONVERSATION_KEYS = [
	"gen_ai.conversation.id",
	"gen_ai.conversation_id",
];
const SESSION_KEYS = ["coding_agent.session.id"];
const TOOL_NAME_KEYS = ["gen_ai.tool.name", "gen_ai.tool.call.name", "tool.name"];
const TOOL_ARGS_KEYS = [
	"gen_ai.tool.args",
	"gen_ai.tool.call.arguments",
	"gen_ai.tool.arguments",
	"gen_ai.tool.input",
];
const COST_KEYS = ["gen_ai.usage.cost", "coding_agent.session.cost_usd"];
const TOTAL_TOKEN_KEYS = ["gen_ai.usage.total_tokens"];
const INPUT_TOKEN_KEYS = [
	"gen_ai.usage.input_tokens",
	"gen_ai.usage.prompt_tokens",
];
const OUTPUT_TOKEN_KEYS = [
	"gen_ai.usage.output_tokens",
	"gen_ai.usage.completion_tokens",
];

export function hasAgentLoopFilter(value: unknown): boolean {
	if (value === true || value === 1 || value === "1" || value === "true") {
		return true;
	}
	if (Array.isArray(value)) {
		return value.some(
			(item) => item === "loop" || item === true || item === "true"
		);
	}
	return false;
}

function firstAttr(
	attrs: Record<string, unknown> | undefined,
	keys: string[]
): string {
	if (!attrs) return "";
	for (const key of keys) {
		const value = attrs[key];
		if (value === undefined || value === null) continue;
		const text = String(value).trim();
		if (text && text !== "-") return text;
	}
	return "";
}

export function spanLoopAttrs(span: AgentLoopSpan): Record<string, unknown> {
	return {
		...(span.resourceAttributes || span.ResourceAttributes || {}),
		...(span.spanAttributes || span.SpanAttributes || {}),
	};
}

export function spanTraceId(span: AgentLoopSpan, index = 0): string {
	const id = String(span.traceId || span.TraceId || "").trim();
	return id || `span:${index}`;
}

export function collapseWhitespace(raw: string): string {
	return raw.trim().replace(/\s+/g, " ");
}

/** Same fingerprint ClickHouse uses: collapse whitespace, no JSON parse. */
export function fingerprintToolArgs(raw: unknown): string {
	if (raw === undefined || raw === null) return "";
	const text = typeof raw === "string" ? raw : JSON.stringify(raw);
	return collapseWhitespace(text);
}

export function conversationGroupKey(
	attrs: Record<string, unknown> | undefined,
	traceId: string
): string {
	const conversation = firstAttr(attrs, CONVERSATION_KEYS);
	if (conversation) return `c:${conversation}`;
	const session = firstAttr(attrs, SESSION_KEYS);
	if (session) return `s:${session}`;
	const id = String(traceId || "").trim();
	return id ? `t:${id}` : "";
}

export function toolNameOf(attrs: Record<string, unknown> | undefined): string {
	return firstAttr(attrs, TOOL_NAME_KEYS);
}

export function toolArgsOf(attrs: Record<string, unknown> | undefined): string {
	return firstAttr(attrs, TOOL_ARGS_KEYS);
}

function parseNumber(raw: string): number {
	if (!raw) return 0;
	const numeric = Number(raw);
	return Number.isFinite(numeric) ? numeric : 0;
}

export function spanCostOf(attrs: Record<string, unknown> | undefined): number {
	return parseNumber(firstAttr(attrs, COST_KEYS));
}

export function spanTokensOf(attrs: Record<string, unknown> | undefined): number {
	const total = parseNumber(firstAttr(attrs, TOTAL_TOKEN_KEYS));
	if (total > 0) return total;
	return (
		parseNumber(firstAttr(attrs, INPUT_TOKEN_KEYS)) +
		parseNumber(firstAttr(attrs, OUTPUT_TOKEN_KEYS))
	);
}

export function isToolSpan(attrs: Record<string, unknown> | undefined): boolean {
	return Boolean(toolNameOf(attrs));
}

function spanTimestampMs(span: AgentLoopSpan): number {
	const raw = span.timestamp || span.Timestamp || "";
	const ms = new Date(String(raw)).getTime();
	return Number.isFinite(ms) ? ms : 0;
}

export function detectAgentLoops(
	spans: AgentLoopSpan[],
	threshold: number = AGENT_LOOP_THRESHOLD
): AgentLoopGroup[] {
	type Bucket = {
		groupKey: string;
		toolName: string;
		fingerprint: string;
		items: Array<{
			traceId: string;
			tokens: number;
			cost: number;
			timestamp: number;
		}>;
	};
	const buckets = new Map<string, Bucket>();
	spans.forEach((span, index) => {
		const attrs = spanLoopAttrs(span);
		if (!isToolSpan(attrs)) return;
		const fingerprint = fingerprintToolArgs(toolArgsOf(attrs));
		// Empty args are not a comparable call — coding-agent Bash/etc. with
		// no arguments would otherwise collapse into one false loop group.
		if (!fingerprint) return;
		const traceId = spanTraceId(span, index);
		const groupKey = conversationGroupKey(attrs, traceId);
		if (!groupKey) return;
		const toolName = toolNameOf(attrs);
		const key = `${groupKey}\0${toolName}\0${fingerprint}`;
		const bucket = buckets.get(key);
		const item = {
			traceId,
			tokens: spanTokensOf(attrs),
			cost: spanCostOf(attrs),
			timestamp: spanTimestampMs(span),
		};
		if (bucket) bucket.items.push(item);
		else {
			buckets.set(key, {
				groupKey,
				toolName,
				fingerprint,
				items: [item],
			});
		}
	});

	const loops: AgentLoopGroup[] = [];
	for (const bucket of Array.from(buckets.values())) {
		if (bucket.items.length < threshold) continue;
		const ordered = bucket.items
			.slice()
			.sort((a, b) => a.timestamp - b.timestamp);
		const extras = ordered.slice(1);
		const traceIds: string[] = [];
		const seen = new Set<string>();
		for (const item of ordered) {
			if (!item.traceId || seen.has(item.traceId)) continue;
			seen.add(item.traceId);
			traceIds.push(item.traceId);
		}
		loops.push({
			groupKey: bucket.groupKey,
			toolName: bucket.toolName,
			fingerprint: bucket.fingerprint,
			count: ordered.length,
			wastedTokens: extras.reduce((sum, item) => sum + item.tokens, 0),
			wastedCost: extras.reduce((sum, item) => sum + item.cost, 0),
			traceIds,
		});
	}
	return loops.sort((a, b) => b.count - a.count);
}

export function worstLoop(loops: AgentLoopGroup[]): AgentLoopHit | undefined {
	const top = loops[0];
	if (!top) return undefined;
	return {
		toolName: top.toolName,
		count: top.count,
		wastedTokens: top.wastedTokens,
		wastedCost: top.wastedCost,
	};
}

export function loopHitsByTraceId(
	spans: AgentLoopSpan[],
	threshold: number = AGENT_LOOP_THRESHOLD
): Map<string, AgentLoopHit> {
	const hits = new Map<string, AgentLoopHit>();
	for (const loop of detectAgentLoops(spans, threshold)) {
		const hit: AgentLoopHit = {
			toolName: loop.toolName,
			count: loop.count,
			wastedTokens: loop.wastedTokens,
			wastedCost: loop.wastedCost,
		};
		for (const traceId of loop.traceIds) {
			const current = hits.get(traceId);
			if (!current || hit.count > current.count) hits.set(traceId, hit);
		}
	}
	return hits;
}

export function listedSpansMatchingAgentLoop<T extends AgentLoopSpan>(
	spans: T[],
	enabled: boolean,
	threshold: number = AGENT_LOOP_THRESHOLD
): T[] {
	if (!enabled) return spans;
	const hits = loopHitsByTraceId(spans, threshold);
	if (!hits.size) return [];
	const grouped = new Map<string, T[]>();
	spans.forEach((span, index) => {
		const key = spanTraceId(span, index);
		const group = grouped.get(key);
		if (group) group.push(span);
		else grouped.set(key, [span]);
	});
	const listed: T[] = [];
	for (const [traceId, group] of Array.from(grouped.entries())) {
		if (!hits.has(traceId)) continue;
		const toolHit = group.find((span) => isToolSpan(spanLoopAttrs(span)));
		listed.push(toolHit || group[0]);
	}
	return listed;
}

export function uniqueTraceCount(spans: AgentLoopSpan[]): number {
	const ids = new Set<string>();
	for (const span of spans) {
		const id = String(span.traceId || span.TraceId || "").trim();
		if (id) ids.add(id);
	}
	return ids.size || spans.length;
}

export function asAgentLoopHit(value: unknown): AgentLoopHit | undefined {
	if (!value || typeof value !== "object") return undefined;
	const row = value as Record<string, unknown>;
	const toolName = String(row.toolName || "").trim();
	const count = Number(row.count);
	if (!toolName || !Number.isFinite(count) || count < AGENT_LOOP_THRESHOLD) {
		return undefined;
	}
	return {
		toolName,
		count,
		wastedTokens: Number(row.wastedTokens) || 0,
		wastedCost: Number(row.wastedCost) || 0,
	};
}
