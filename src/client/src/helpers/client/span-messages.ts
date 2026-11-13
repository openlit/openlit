export type SpanMessage = { role: string; content: string };

export type StructuredContent =
	| { kind: "messages"; messages: SpanMessage[] }
	| { kind: "json"; value: object }
	| { kind: "text" }
	| { kind: "raw" };

/** Attributes whose text is model or agent prose, so markdown is meaningful. */
export const SPAN_CONTENT_KEYS = new Set([
	"gen_ai.input.messages",
	"gen_ai.output.messages",
	"gen_ai.system_instructions",
	"gen_ai.content.prompt",
	"gen_ai.content.completion",
	"gen_ai.content.revised_prompt",
	"gen_ai.prompt",
	"gen_ai.completion",
	"gen_ai.request.input",
	"gen_ai.response.output",
	"coding_agent.llm.thought.text",
	"coding_agent.subagent.task",
	"coding_agent.subagent.summary",
]);

export function tryParseJson(raw: unknown): any[] | null {
	if (raw == null) return null;
	try {
		const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * True when the string looks like it was meant to be JSON (starts
 * with `[` or `{`, optionally after whitespace). Used by
 * `extractTextMessages` to suppress the raw-string fallback when
 * the value was clearly a serialised messages envelope that simply
 * failed to parse — usually because it was truncated mid-token at
 * the OTLP attribute-size cap. Without this guard, the truncated
 * blob renders as a "user" bubble with the full raw JSON inside,
 * which is how Claude Code traces ended up showing tool_result
 * contents as user messages.
 */
export function looksLikeJson(raw: string): boolean {
	const trimmed = raw.trimStart();
	return trimmed.startsWith("[") || trimmed.startsWith("{");
}

export function extractTextMessages(
	raw: unknown,
	defaultRole: "user" | "assistant" = "user"
): SpanMessage[] {
	if (raw == null) return [];
	// The CLI emits `gen_ai.{input,output}.messages` per the OTel
	// GenAI semantic convention (https://github.com/open-telemetry/
	// semantic-conventions-genai → docs/gen-ai/gen-ai-spans.md):
	//   [{ role, parts: [{ type: "text", content: "..." }],
	//      finish_reason? }]
	// Tool-call / tool-call-response parts are intentionally NOT
	// stamped onto LLM-turn messages by the CLI — the canonical
	// source for tool data is the matching `coding_agent.tool.call`
	// span. See cli/internal/otlp/attrs.go for the rationale.
	//
	// Legacy paths fall back to a plain string body and to OpenAI's
	// `content: "..."` / `content: [{type:"text", text:"..."}]` so
	// vendors mid-migration still render.
	const arr = tryParseJson(raw);
	if (!arr) {
		if (typeof raw === "string" && raw.trim()) {
			// Drop unparseable strings that look like JSON — they're
			// almost always a truncated messages envelope, and
			// rendering them verbatim creates the "tool_result JSON
			// appears as a user bubble" failure mode.
			if (looksLikeJson(raw)) return [];
			return [{ role: defaultRole, content: raw }];
		}
		return [];
	}

	const result: SpanMessage[] = [];
	for (const msg of arr) {
		if (!msg) continue;
		const role = msg.role || "unknown";

		if (Array.isArray(msg.parts)) {
			const lines: string[] = [];
			for (const p of msg.parts) {
				if (!p?.type) continue;
				if (p.type === "text") {
					// OTel canonical uses `content`; legacy emitters
					// may use `text` — accept both for resilience.
					const t =
						(typeof p.content === "string" && p.content) ||
						(typeof p.text === "string" && p.text) ||
						"";
					if (t) lines.push(t);
				}
				// `tool_call` / `tool_call_response` parts are
				// intentionally ignored here. Tool data lives on
				// `coding_agent.tool.call` spans (rendered by
				// `ToolIndicator` below); duplicating it inside a
				// chat bubble produces redundant "Tool Result" /
				// "🛠 tool_call" lines that clutter the conversation.
			}
			if (lines.length > 0) {
				result.push({ role, content: lines.join("\n\n") });
			}
			continue;
		}

		if (typeof msg.content === "string" && msg.content.trim()) {
			result.push({ role, content: msg.content });
			continue;
		}

		if (Array.isArray(msg.content)) {
			const texts: string[] = [];
			for (const part of msg.content) {
				if (part?.type === "text" && typeof part.text === "string") {
					texts.push(part.text);
				}
			}
			if (texts.length > 0) {
				result.push({ role, content: texts.join("\n") });
			}
		}
	}
	return result;
}

export function normalizeRole(role: string): "user" | "assistant" | "system" | "tool" {
	if (role === "assistant") return "assistant";
	if (role === "system") return "system";
	if (role === "tool" || role === "function") return "tool";
	return "user";
}

export function tryPrettyJson(raw: string): string | null {
	try {
		const parsed = JSON.parse(raw);
		return JSON.stringify(parsed, null, 2);
	} catch {
		return null;
	}
}

export function isEmptyValue(value: unknown) {
	return value === "" || value === null || value === undefined;
}

export function stringifyValue(value: unknown) {
	if (isEmptyValue(value)) return "-";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/**
 * Picks how a span value should be shown. Truncated JSON is `raw` rather than
 * `text` so it is never rendered as markdown, and a role array only counts as
 * messages when text survives `extractTextMessages`; otherwise the JSON tree
 * keeps what that parser would drop.
 */
export function parseStructuredValue(value: unknown): StructuredContent {
	let parsed = value;
	if (typeof value === "string" && looksLikeJson(value)) {
		try {
			parsed = JSON.parse(value);
		} catch {
			return { kind: "raw" };
		}
	}
	if (typeof parsed !== "object" || parsed === null) return { kind: "text" };

	const isChat =
		Array.isArray(parsed) &&
		parsed.every((message) => typeof message?.role === "string");
	const messages = isChat ? extractTextMessages(parsed) : [];
	return messages.length > 0
		? { kind: "messages", messages }
		: { kind: "json", value: parsed };
}
