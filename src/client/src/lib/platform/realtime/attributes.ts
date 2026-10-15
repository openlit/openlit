import { REALTIME_NUMERIC_FIELDS, REALTIME_STRING_FIELDS } from "./rule-fields";

/**
 * Realtime rules may match or group by any span or resource attribute. Keep
 * these rules in sync with src/otlp-receiver/internal/signal/attrs.go and
 * src/engine/internal/signal/attrs.go.
 *
 * Prompt, completion, message, and secret attributes are never accepted,
 * including when OPENLIT_SIGNAL_ATTRIBUTES names them. Personal keys (user,
 * session, and conversation ids, email, phone, IP, URL paths, server
 * addresses) cross the bus only when OPENLIT_SIGNAL_ATTRIBUTES lists them.
 *
 * REALTIME_ATTRIBUTE_FIELDS are the common keys suggested in the editor.
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
	"server.port",
	"db.system",
	"db.operation.name",
	"service.version",
	"deployment.environment",
] as const;

const SENSITIVE_ATTRIBUTE = /prompt|completion|messages?|content|secret|password|authorization|api[_-]?key|credential|cookie|bearer|instruction/i;

const ATTRIBUTE_KEY = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;

export function isSensitiveAttributeKey(key: string): boolean {
	return SENSITIVE_ATTRIBUTE.test(key);
}

const BUILTIN_FIELDS = new Set<string>([...REALTIME_STRING_FIELDS, "environment", ...REALTIME_NUMERIC_FIELDS]);

const PERSONAL_SEGMENTS = new Set(["user", "enduser", "session", "conversation", "email", "phone", "ip", "address", "path"]);

/** Keys that identify people or private locations; usable only when configured. */
export function isPersonalAttributeKey(key: string): boolean {
	return key
		.toLowerCase()
		.split(/[._-]/)
		.some((segment) => PERSONAL_SEGMENTS.has(segment));
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

/** Any well-formed, non-sensitive attribute; personal keys only when OPENLIT_SIGNAL_ATTRIBUTES lists them. */
export function isRealtimeAttributeField(field: string): boolean {
	// Built-in field names always mean the built-in field.
	if (!isRealtimeMapKey(field) || BUILTIN_FIELDS.has(field)) return false;
	if (!isPersonalAttributeKey(field)) return true;
	return extraAttributeFields().has(field);
}
