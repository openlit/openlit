import {
	fingerprintToolArgs,
	toolArgsOf,
	toolNameOf,
	spanLoopAttrs,
	type AgentLoopSpan,
} from "@/lib/platform/agent-loop/classify";
import type { TraceHeirarchySpan } from "@/types/trace";

const FILE_ATTR_KEYS = [
	"code.file.path",
	"coding_agent.edit.file.path",
	"gen_ai.tool.target",
];

const FILE_ARG_KEYS = [
	"path",
	"file",
	"file_path",
	"filepath",
	"target_file",
	"target",
	"uri",
];

function firstString(
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

function tryParseObject(raw: string): Record<string, unknown> | null {
	const trimmed = raw.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
	try {
		const parsed = JSON.parse(trimmed);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return null;
	}
	return null;
}

/** Best-effort file/path hint from span attributes or tool arguments (no LLM). */
export function extractResourceHint(
	span: TraceHeirarchySpan | AgentLoopSpan
): string {
	const attrs = spanLoopAttrs(span as AgentLoopSpan);
	const direct = firstString(attrs, FILE_ATTR_KEYS);
	if (direct) return direct;

	const argsRaw = toolArgsOf(attrs);
	if (!argsRaw) return "";
	const parsed = tryParseObject(argsRaw);
	if (parsed) {
		const fromKeys = firstString(parsed, FILE_ARG_KEYS);
		if (fromKeys) return fromKeys;
	}

	// Fallback: pull a path-looking token from the fingerprint string.
	const fp = fingerprintToolArgs(argsRaw);
	const match = fp.match(
		/(?:^|["'\s=])((?:\/|~\/|\.\/|[A-Za-z]:\\)[^\s"'`,;]{2,240})/
	);
	return match?.[1] || "";
}

export function matchingLoopSpans(
	spans: TraceHeirarchySpan[],
	toolName: string,
	fingerprint: string
): TraceHeirarchySpan[] {
	return spans.filter((span) => {
		const attrs = spanLoopAttrs({
			SpanAttributes: span.SpanAttributes,
			ResourceAttributes: span.ResourceAttributes,
		});
		if (toolNameOf(attrs) !== toolName) return false;
		return fingerprintToolArgs(toolArgsOf(attrs)) === fingerprint;
	});
}
