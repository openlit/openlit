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

export type ParsedModelJson = {
	value: unknown;
	/** True when the value was salvaged from cut-off (truncated) output. */
	recovered: boolean;
};

/** Accepts any JSON object or array. */
export function isJsonContainer(value: unknown): boolean {
	return typeof value === "object" && value !== null;
}

/** Bounds the scan so a pathological response can't make parsing quadratic. */
const MAX_CANDIDATE_STARTS = 400;

/**
 * Finds the JSON payload in a model response that may wrap it in code fences
 * and/or surround it with prose, notes or example snippets.
 *
 * Scans for complete JSON values with a string-aware bracket matcher (so
 * backticks or brackets inside JSON strings are ignored), skips fragments
 * that don't parse (e.g. a "[Label evaluation context]" aside), and returns
 * the first value `accept` recognises as the payload, so an earlier example
 * or unrelated object is passed over. If no complete value qualifies, falls
 * back to `recoverTruncatedJson` for cut-off output and marks the result
 * `recovered`.
 */
export function parseModelJson(
	raw: string,
	accept: (value: unknown) => boolean = isJsonContainer
): ParsedModelJson | null {
	const text = raw.trim();
	const whole = tryParse(text);
	if (whole !== null && accept(whole)) return { value: whole, recovered: false };

	let attempts = 0;
	for (let i = 0; i < text.length && attempts < MAX_CANDIDATE_STARTS; i++) {
		const ch = text[i];
		if (ch !== "{" && ch !== "[") continue;
		attempts++;
		const end = balancedEnd(text, i);
		if (end < 0) {
			// Never closes: cut-off output (or a stray bracket in prose). Salvage
			// it here, before any complete value nested inside it can win.
			const body = text.slice(i).replace(/\s*```\s*$/, "");
			const value = recoverTruncatedJson(body);
			if (value !== null && accept(value)) return { value, recovered: true };
			continue;
		}
		const value = tryParse(text.slice(i, end));
		if (value === null) continue; // prose fragment; look inside/after it
		if (accept(value)) return { value, recovered: false };
		i = end - 1; // a complete but unrelated value: skip past it
	}
	return null;
}

/** Index just past the bracket closing the value that opens at `text[start]`, or -1. */
function balancedEnd(text: string, start: number): number {
	const stack: string[] = [];
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
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
