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
