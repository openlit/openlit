import {
	extractResourceHint,
	matchingLoopSpans,
} from "@/lib/platform/governance/evidence";
import type { TraceHeirarchySpan } from "@/types/trace";

function makeSpan(
	overrides: Partial<TraceHeirarchySpan> & Pick<TraceHeirarchySpan, "SpanId">
): TraceHeirarchySpan {
	return {
		SpanName: "tool",
		Duration: 1,
		SpanAttributes: {},
		ResourceAttributes: {},
		children: [],
		...overrides,
	};
}

describe("governance evidence", () => {
	it("extracts file paths from tool args json", () => {
		const hint = extractResourceHint(
			makeSpan({
				SpanId: "s1",
				SpanAttributes: {
					"gen_ai.tool.name": "read_file",
					"gen_ai.tool.args": '{"path":"/tmp/demo.ts"}',
				},
			})
		);
		expect(hint).toBe("/tmp/demo.ts");
	});

	it("matches loop spans by tool name and fingerprint", () => {
		const args = '{"path":"/a.ts"}';
		const spans = [
			makeSpan({
				SpanId: "a",
				SpanAttributes: {
					"gen_ai.tool.name": "read_file",
					"gen_ai.tool.args": args,
				},
			}),
			makeSpan({
				SpanId: "b",
				SpanAttributes: {
					"gen_ai.tool.name": "write",
					"gen_ai.tool.args": args,
				},
			}),
		];
		const matched = matchingLoopSpans(spans, "read_file", args);
		expect(matched.map((s) => s.SpanId)).toEqual(["a"]);
	});
});
