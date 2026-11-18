import { parseModelJson, recoverTruncatedJson } from "@/lib/platform/chat/json-recovery";

const full = JSON.stringify({
	summary: "Two findings",
	findings: [
		{ severity: "major", summary: "First", span_refs: ["a", "b"] },
		{ severity: "minor", summary: "Second \"quoted\" {brace}", span_refs: ["c"] },
	],
});

describe("recoverTruncatedJson", () => {
	it("returns complete JSON unchanged", () => {
		expect(recoverTruncatedJson(full)).toEqual(JSON.parse(full));
	});

	it("keeps complete findings when cut inside a later finding's string", () => {
		const cut = full.slice(0, full.indexOf("Second") + 4);
		expect(recoverTruncatedJson(cut)).toEqual({
			summary: "Two findings",
			findings: [{ severity: "major", summary: "First", span_refs: ["a", "b"] }],
		});
	});

	it("ignores brackets and escaped quotes inside strings", () => {
		const cut = full.slice(0, full.lastIndexOf("span_refs"));
		const recovered = recoverTruncatedJson(cut) as { findings: unknown[] };
		expect(recovered.findings).toHaveLength(1);
	});

	it("returns null when the first finding is cut inside its nested array", () => {
		const cut = full.slice(0, full.indexOf('"a"') + 3);
		expect(recoverTruncatedJson(cut)).toBeNull();
	});

	it("returns null when nothing complete precedes the cut", () => {
		expect(recoverTruncatedJson('{"summary": "Session consumed ~9.6M tok')).toBeNull();
		expect(recoverTruncatedJson("not json")).toBeNull();
	});

	it("returns null on mismatched brackets", () => {
		expect(recoverTruncatedJson('{"findings": [}]')).toBeNull();
	});

	it("ignores trailing text after a complete document", () => {
		expect(recoverTruncatedJson('{"a": 1} trailing')).toEqual({ a: 1 });
	});
});

describe("parseModelJson", () => {
	const empty = { summary: "No concrete findings for this dimension.", findings: [] };
	const hasFindings = (v: any) => Array.isArray(v?.findings);
	const value = (raw: string, accept?: (v: unknown) => boolean) =>
		parseModelJson(raw, accept)?.value;

	it("ignores prose after a fenced block (trace analysis regression)", () => {
		const raw =
			'```json { "summary": "No concrete findings for this dimension.", "findings": [] } ``` **Rationale:** The trace contains a single LLM call (span `038160a0b6eddfc1`) with no tool calls.';
		expect(parseModelJson(raw)).toEqual({ value: empty, recovered: false });
	});

	it("handles a multi-line fence with a preamble", () => {
		const raw = `Here is the analysis:\n\n\`\`\`json\n${full}\n\`\`\`\n\nLet me know if you need more.`;
		expect(value(raw)).toEqual(JSON.parse(full));
	});

	it("extracts the first balanced object from unfenced prose", () => {
		const raw = `Result: ${full} -- note: braces like { in prose after are ignored`;
		expect(value(raw)).toEqual(JSON.parse(full));
	});

	it("returns plain JSON unchanged", () => {
		expect(parseModelJson(`  ${full}  `)).toEqual({ value: JSON.parse(full), recovered: false });
	});

	it("keeps a code fence that appears inside a JSON string", () => {
		const payload = { summary: "Use a fence", findings: [{ detail: "Wrap it:\n```js\nrun()\n```" }] };
		const raw = "```json\n" + JSON.stringify(payload, null, 2) + "\n```\nDone.";
		expect(value(raw, hasFindings)).toEqual(payload);
	});

	it("skips an earlier fenced example that is not the payload", () => {
		const raw =
			'For reference, a span looks like:\n```json\n{"spanId": "abc"}\n```\nAnalysis:\n```json\n' +
			full +
			"\n```";
		expect(value(raw, hasFindings)).toEqual(JSON.parse(full));
	});

	it("skips bracketed prose before the payload", () => {
		const raw = `[Hallucination evaluation context] considered. ${full}`;
		expect(value(raw)).toEqual(JSON.parse(full));
	});

	it("recovers a truncated fenced response and flags it", () => {
		const raw = "```json\n" + full.slice(0, full.indexOf("Second") - 20);
		expect(parseModelJson(raw, hasFindings)).toEqual({
			value: {
				summary: "Two findings",
				findings: [{ severity: "major", summary: "First", span_refs: ["a", "b"] }],
			},
			recovered: true,
		});
	});

	it("returns null for text with no JSON", () => {
		expect(parseModelJson("I could not analyse this trace.")).toBeNull();
	});
});
