import { recoverTruncatedJson } from "@/lib/platform/chat/json-recovery";

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
