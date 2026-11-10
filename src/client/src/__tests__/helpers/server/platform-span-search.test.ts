import {
	getFilterWhereCondition,
	getSpanListWhereCondition,
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import {
	SPAN_SEARCH_MAX_DAYS,
	SPAN_SEARCH_MAX_LENGTH,
	SPAN_SEARCH_MAX_TERMS,
} from "@/constants/traces";
import { OBSERVABILITY_SPAN_SEARCH_RANGE_TOO_WIDE } from "@/constants/messages/en";

function params(search: unknown, timeLimit?: Record<string, unknown>) {
	return {
		timeLimit: timeLimit ?? {
			start: "2026-10-01T00:00:00.000Z",
			end: "2026-10-02T00:00:00.000Z",
			type: "CUSTOM",
		},
		selectedConfig: { search },
	} as any;
}

describe("getSpanListWhereCondition", () => {
	it("matches the named content keys and StatusMessage", () => {
		const { where } = getSpanListWhereCondition(params("refund"));

		expect(where).toContain("positionCaseInsensitiveUTF8(SpanAttributes['gen_ai.input.messages'], 'refund') > 0");
		expect(where).toContain("positionCaseInsensitiveUTF8(SpanAttributes['gen_ai.output.messages'], 'refund') > 0");
		expect(where).toContain("positionCaseInsensitiveUTF8(SpanAttributes['gen_ai.prompt'], 'refund') > 0");
		expect(where).toContain("positionCaseInsensitiveUTF8(SpanAttributes['gen_ai.completion'], 'refund') > 0");
		expect(where).toContain("positionCaseInsensitiveUTF8(StatusMessage, 'refund') > 0");
		expect(where).toContain("arrayExists(attrs -> ");
		expect(where).toContain("positionCaseInsensitiveUTF8(attrs['gen_ai.prompt'], 'refund') > 0");
		expect(where).toContain("positionCaseInsensitiveUTF8(attrs['gen_ai.completion'], 'refund') > 0");
		expect(where).toContain("positionCaseInsensitiveUTF8(attrs['exception.message'], 'refund') > 0");
		expect(where).toContain("`Events.Attributes`)");
	});

	describe("serialised message content", () => {
		const inputNeedles = (search: string) => {
			const { where } = getSpanListWhereCondition(params(search));
			return Array.from(
				where.matchAll(
					/positionCaseInsensitiveUTF8\(SpanAttributes\['gen_ai\.input\.messages'\], '((?:[^'\\]|\\.)*)'\)/g
				),
				(match) => match[1].replace(/\\(.)/g, "$1")
			);
		};
		const matchesRow = (search: string, row: string) =>
			inputNeedles(search).some((needle) =>
				row.toLowerCase().includes(needle.toLowerCase())
			);

		// Verbatim output of Python's json.dumps, as written by the openai and
		// anthropic instrumentations for this prompt:
		// ¿Dónde está mi 订单 😀 say "hi" C:\temp
		const pythonRow = String.raw`[{"role": "user", "content": "\u00bfD\u00f3nde est\u00e1 mi \u8ba2\u5355 \ud83d\ude00 say \"hi\" C:\\temp"}]`;
		// The same prompt from an SDK that keeps non-ASCII, like JSON.stringify.
		const jsRow = JSON.stringify([
			{ role: "user", content: '¿Dónde está mi 订单 😀 say "hi" C:\\temp' },
		]);

		it.each([
			["accented text", "Dónde"],
			["accented text in another case", "DóNDE"],
			["CJK text", "订单"],
			["an emoji", "😀"],
			["double quotes", 'say "hi"'],
			["a backslash", "C:\\temp"],
		])("finds %s in every JSON spelling", (_label, search) => {
			expect(matchesRow(search, pythonRow)).toBe(true);
			expect(matchesRow(search, jsRow)).toBe(true);
		});

		it("still finds a raw value that was not JSON-encoded", () => {
			expect(matchesRow("Dónde", "¿Dónde está?")).toBe(true);
		});

		it("does not match unrelated text", () => {
			expect(matchesRow("订单", pythonRow.replace("\\u8ba2", "\\u8ba3"))).toBe(false);
		});

		it("adds one clause per key for a plain ASCII term", () => {
			expect(inputNeedles("refund")).toEqual(["refund"]);
		});

		it("keeps every spelling inside the string literal", () => {
			expect(getSpanListWhereCondition(params("'\"é")).where).toContain(
				"positionCaseInsensitiveUTF8(SpanAttributes['gen_ai.input.messages'], '\\'\\\\\"\\\\u00e9') > 0"
			);
		});

		it("leaves non-JSON keys to the raw term", () => {
			const { where } = getSpanListWhereCondition(params("订单"));
			expect(where).not.toContain("SpanAttributes['gen_ai.prompt'], '\\\\u");
			expect(where).toContain("positionCaseInsensitiveUTF8(SpanAttributes['gen_ai.prompt'], '订单') > 0");
		});
	});

	describe("multi-word searches", () => {
		const outputNeedles = (search: string) =>
			Array.from(
				getSpanListWhereCondition(params(search)).where.matchAll(
					/positionCaseInsensitiveUTF8\(SpanAttributes\['gen_ai\.output\.messages'\], '((?:[^'\\]|\\.)*)'\)/g
				),
				(match) => match[1]
			);

		it("requires every word, so markdown between words still matches", () => {
			const { where } = getSpanListWhereCondition(params("ships tomorrow"));
			expect(outputNeedles("ships tomorrow")).toEqual(["ships", "tomorrow"]);
			expect(where).toMatch(/'ships'\) > 0 OR .*\) AND \(.*'tomorrow'\) > 0/);
			expect(where).not.toContain("'ships tomorrow'");
		});

		it("keeps a double-quoted phrase as one term", () => {
			expect(outputNeedles('"ships tomorrow" order')).toEqual([
				"ships tomorrow",
				"order",
			]);
		});

		it("ignores repeated words and extra spaces", () => {
			expect(outputNeedles("  refund   REFUND refund ")).toEqual(["refund", "REFUND"]);
		});

		it("searches an unpaired quote as typed", () => {
			const needles = outputNeedles('5" screen');
			expect(needles).toContain('5"');
			expect(needles).toContain("screen");
		});

		it("caps the number of words", () => {
			const words = Array.from({ length: SPAN_SEARCH_MAX_TERMS + 5 }, (_, i) => `w${i}`);
			expect(outputNeedles(words.join(" "))).toHaveLength(SPAN_SEARCH_MAX_TERMS);
		});
	});

	it("never scans whole attribute maps", () => {
		expect(getSpanListWhereCondition(params("refund")).where).not.toContain("mapValues");
	});

	it("keeps the other filters", () => {
		const { where } = getSpanListWhereCondition({
			...params("refund"),
			selectedConfig: { search: "refund", models: ["gpt-4o"] },
		});
		expect(where).toContain("IN ('gpt-4o')");
	});

	it.each([
		["single quote", "x')OR(1=1)--", "'x\\')OR(1=1)--'"],
		["single quote in a phrase", '"x\') OR 1=1 --"', "'x\\') OR 1=1 --'"],
		["backslash before a quote", '"a\\\' OR 1=1 --"', "'a\\\\\\' OR 1=1 --'"],
		["trailing backslash", "tail\\", "'tail\\\\'"],
		["control characters", "a\u0000b\u007f", "'ab'"],
	])("escapes %s", (_label, search, expected) => {
		expect(getSpanListWhereCondition(params(search)).where).toContain(
			`positionCaseInsensitiveUTF8(StatusMessage, ${expected}) > 0`
		);
	});

	it.each([
		["empty", ""],
		["whitespace", "   "],
		["only control characters", "\u0000\u0001"],
		["control characters between spaces", "\u0000 \u0001"],
		["a non-string", { $ne: 1 }],
		["missing", undefined],
	])("adds no clause when search is %s", (_label, search) => {
		const { where, err } = getSpanListWhereCondition(params(search));
		expect(err).toBeUndefined();
		expect(where).not.toContain("positionCaseInsensitiveUTF8");
	});

	it("allows the widest permitted range", () => {
		const { err } = getSpanListWhereCondition(
			params("refund", {
				start: "2026-10-01T00:00:00.000Z",
				end: "2026-10-08T00:00:00.000Z",
				type: "7D",
			})
		);
		expect(err).toBeUndefined();
	});

	it("rejects a wider range with a clear message", () => {
		const { err } = getSpanListWhereCondition(
			params("refund", {
				start: "2026-10-01T00:00:00.000Z",
				end: "2026-10-09T00:00:00.000Z",
				type: "CUSTOM",
			})
		);
		expect(err).toBe(OBSERVABILITY_SPAN_SEARCH_RANGE_TOO_WIDE(SPAN_SEARCH_MAX_DAYS));
	});

	it("does not limit the range without a search", () => {
		const { err } = getSpanListWhereCondition(
			params("", { start: "2026-01-01", end: "2026-10-01", type: "CUSTOM" })
		);
		expect(err).toBeUndefined();
	});
});

describe("getFilterWhereCondition", () => {
	it("leaves search to the list and count queries", () => {
		const where = getFilterWhereCondition(params("refund"), true);
		expect(where).not.toContain("positionCaseInsensitiveUTF8");
		expect(where).not.toContain("refund");
	});
});

describe("validateMetricsRequest search sanitising", () => {
	it("trims and caps the search length", () => {
		const request = params(`  ${"x".repeat(SPAN_SEARCH_MAX_LENGTH + 50)}  `);

		expect(validateMetricsRequest(request, validateMetricsRequestType.GET_ALL).success).toBe(true);
		expect(request.selectedConfig.search).toBe("x".repeat(SPAN_SEARCH_MAX_LENGTH));
	});
});
