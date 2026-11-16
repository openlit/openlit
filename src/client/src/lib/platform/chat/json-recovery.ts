/**
 * Best-effort recovery for model JSON that was cut off mid-stream (for
 * example when a response hits its output-token limit).
 *
 * Walks the text tracking string and bracket state, remembers the last point
 * where a value inside an array closed cleanly, and closes the remaining open
 * brackets from there. Complete array items (e.g. findings) survive; the
 * partial item at the cut is dropped. Returns null when nothing usable can be
 * salvaged.
 */
export function recoverTruncatedJson(text: string): unknown | null {
	const stack: string[] = [];
	let inString = false;
	let escaped = false;
	let lastSafeEnd = -1;
	let stackAtLastSafe: string[] = [];

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === "{" || ch === "[") {
			stack.push(ch === "{" ? "}" : "]");
		} else if (ch === "}" || ch === "]") {
			if (stack.pop() !== ch) return null;
			if (stack.length === 0) return tryParse(text.slice(0, i + 1));
			if (stack[stack.length - 1] === "]") {
				lastSafeEnd = i + 1;
				stackAtLastSafe = [...stack];
			}
		}
	}

	if (lastSafeEnd < 0) return null;
	return tryParse(text.slice(0, lastSafeEnd) + [...stackAtLastSafe].reverse().join(""));
}

function tryParse(text: string): unknown | null {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

const FENCED_BLOCK = /```[a-z]*[ \t]*\r?\n?([\s\S]*?)```/i;

/**
 * Pulls the JSON payload out of a model response that may wrap it in a code
 * fence and/or surround it with prose (e.g. a "**Rationale:**" paragraph after
 * the closing fence). Returns the first complete fenced block, otherwise the
 * first balanced top-level object/array. When the JSON is cut off (no balanced
 * end), returns everything from its opening bracket so
 * `recoverTruncatedJson` can still salvage it.
 */
export function extractJsonText(raw: string): string {
	const text = raw.trim();
	if (tryParse(text) !== null) return text;

	const fenced = text.match(FENCED_BLOCK);
	if (fenced && fenced[1].trim()) return fenced[1].trim();

	const start = text.search(/[{[]/);
	if (start < 0) return text;
	const body = text.slice(start);
	const end = balancedEnd(body);
	return end < 0 ? body.replace(/\s*```\s*$/, "") : body.slice(0, end);
}

/** Index just past the bracket that closes the value opening at `text[0]`, or -1. */
function balancedEnd(text: string): number {
	const stack: string[] = [];
	let inString = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
		else if (ch === "}" || ch === "]") {
			if (stack.pop() !== ch) return -1;
			if (stack.length === 0) return i + 1;
		}
	}
	return -1;
}

/** Parses model output as JSON, tolerating fences, surrounding prose and truncation. */
export function parseModelJson(raw: string): unknown | null {
	const jsonText = extractJsonText(raw);
	return tryParse(jsonText) ?? recoverTruncatedJson(jsonText);
}
