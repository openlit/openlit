/**
 * Span and resource attributes a realtime rule may match or group by.
 * Keep this list in sync with src/otlp-receiver/internal/signal/attrs.go
 * and src/engine/internal/signal/attrs.go.
 *
 * Prompt, completion, and message attributes are never accepted, including
 * when OPENLIT_SIGNAL_ATTRIBUTES names them.
 */

export const REALTIME_ATTRIBUTE_FIELDS = [
	"gen_ai.tool.name",
	"gen_ai.tool.type",
	"gen_ai.response.finish_reasons",
	"gen_ai.request.temperature",
	"gen_ai.request.max_tokens",
	"gen_ai.request.top_p",
	"gen_ai.request.frequency_penalty",
	"gen_ai.request.presence_penalty",
	"gen_ai.request.seed",
	"http.request.method",
	"http.method",
	"http.route",
	"url.path",
	"server.address",
	"server.port",
	"db.system",
	"db.operation.name",
	"user.id",
	"session.id",
	"enduser.id",
	"conversation.id",
	"gen_ai.conversation.id",
	"service.version",
	"deployment.environment",
] as const;

const SENSITIVE_ATTRIBUTE = /prompt|completion|messages?|content|secret|password|authorization|api[_-]?key|credential|cookie|bearer|instruction/i;

const ATTRIBUTE_KEY = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;

export function isSensitiveAttributeKey(key: string): boolean {
	return SENSITIVE_ATTRIBUTE.test(key);
}

/** Identifier shape used for finding group keys and signal attributes. */
export function isRealtimeMapKey(key: string): boolean {
	return ATTRIBUTE_KEY.test(key) && !isSensitiveAttributeKey(key);
}

function extraAttributeFields(): Set<string> {
	const raw = process.env.OPENLIT_SIGNAL_ATTRIBUTES || "";
	const extra = new Set<string>();
	for (const part of raw.split(/[,\s]+/)) {
		const key = part.trim();
		if (!isRealtimeMapKey(key) || extra.size >= 32) continue;
		extra.add(key);
	}
	return extra;
}

/** True for the built-in allowlist and non-sensitive OPENLIT_SIGNAL_ATTRIBUTES extras. */
export function isRealtimeAttributeField(field: string): boolean {
	if (!isRealtimeMapKey(field)) return false;
	if ((REALTIME_ATTRIBUTE_FIELDS as readonly string[]).includes(field)) return true;
	return extraAttributeFields().has(field);
}
