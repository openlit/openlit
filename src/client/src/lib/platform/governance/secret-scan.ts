/**
 * High-confidence credential/PII detectors for governance. Findings must
 * never persist the matched secret — only a kind label.
 */

export type SecretKind =
	| "aws_access_key"
	| "github_token"
	| "openai_api_key"
	| "anthropic_api_key"
	| "google_api_key"
	| "slack_token"
	| "private_key"
	| "jwt"
	| "password_assignment"
	| "pii_ssn";

const DETECTORS: Array<{ kind: SecretKind; pattern: RegExp }> = [
	{ kind: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{
		kind: "github_token",
		pattern: /\b(?:ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{36,})\b/,
	},
	{ kind: "anthropic_api_key", pattern: /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/ },
	{ kind: "openai_api_key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
	{ kind: "google_api_key", pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
	{ kind: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
	{
		kind: "private_key",
		pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
	},
	{
		kind: "jwt",
		pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
	},
	{
		kind: "password_assignment",
		pattern:
			/["']?(?:password|passwd|secret|api[_-]?key|access[_-]?token)["']?\s*[=:]\s*["']?[^\s"'\\]{12,}/i,
	},
	{ kind: "pii_ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
];

const PAYLOAD_KEYS = [
	"gen_ai.tool.args",
	"gen_ai.tool.call.arguments",
	"gen_ai.tool.arguments",
	"gen_ai.tool.input",
	"gen_ai.tool.result",
	"gen_ai.tool.output",
	"gen_ai.input.messages",
	"gen_ai.output.messages",
	"coding_agent.tool.error_message",
];

export function detectSecretKinds(text: string): SecretKind[] {
	if (!text) return [];
	const found: SecretKind[] = [];
	const seen = new Set<SecretKind>();
	for (const detector of DETECTORS) {
		if (seen.has(detector.kind)) continue;
		if (!detector.pattern.test(text)) continue;
		// OpenAI pattern also matches sk-ant-*; skip if Anthropic already hit.
		if (
			detector.kind === "openai_api_key" &&
			seen.has("anthropic_api_key")
		) {
			continue;
		}
		seen.add(detector.kind);
		found.push(detector.kind);
	}
	return found;
}

export function scanSpanPayloads(
	attrs: Record<string, string | number> | undefined
): SecretKind[] {
	if (!attrs) return [];
	const kinds = new Set<SecretKind>();
	for (const key of PAYLOAD_KEYS) {
		const value = attrs[key];
		if (value === undefined || value === null) continue;
		for (const kind of detectSecretKinds(String(value))) {
			kinds.add(kind);
		}
	}
	return Array.from(kinds);
}
