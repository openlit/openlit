import {
	extractTextMessages,
	normalizeRole,
	parseStructuredValue,
	stringifyValue,
	tryParseJson,
	tryPrettyJson,
} from "@/helpers/client/span-messages";

describe("span-messages", () => {
	describe("extractTextMessages", () => {
		it("reads OTel parts, OpenAI content arrays and plain content", () => {
			const raw = JSON.stringify([
				{ role: "user", parts: [{ type: "text", content: "one" }] },
				{ role: "assistant", content: [{ type: "text", text: "two" }] },
				{ role: "system", content: "three" },
			]);

			expect(extractTextMessages(raw)).toEqual([
				{ role: "user", content: "one" },
				{ role: "assistant", content: "two" },
				{ role: "system", content: "three" },
			]);
		});

		it("wraps a plain string in the default role", () => {
			expect(extractTextMessages("hello", "assistant")).toEqual([
				{ role: "assistant", content: "hello" },
			]);
		});

		it("returns nothing for truncated JSON instead of a raw blob", () => {
			expect(extractTextMessages('[{"role":"user","parts":[{"ty')).toEqual([]);
		});

		it("drops tool-call parts", () => {
			expect(
				extractTextMessages([
					{ role: "assistant", parts: [{ type: "tool_call", name: "search" }] },
				])
			).toEqual([]);
		});
	});

	it("normalizes roles", () => {
		expect(normalizeRole("assistant")).toBe("assistant");
		expect(normalizeRole("function")).toBe("tool");
		expect(normalizeRole("developer")).toBe("user");
	});

	it("parses only JSON arrays and pretty-prints valid JSON", () => {
		expect(tryParseJson('{"a":1}')).toBeNull();
		expect(tryParseJson("[1]")).toEqual([1]);
		expect(tryPrettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
		expect(tryPrettyJson("{bad")).toBeNull();
	});

	describe("parseStructuredValue", () => {
		it("picks messages for chat JSON strings and arrays", () => {
			const messages = [{ role: "user", content: "hi" }];

			expect(parseStructuredValue(JSON.stringify(messages))).toEqual({
				kind: "messages",
				messages,
			});
			expect(parseStructuredValue(messages).kind).toBe("messages");
		});

		it("picks the JSON tree when no text would survive extraction", () => {
			const toolCalls = [
				{ role: "assistant", parts: [{ type: "tool_call", name: "search" }] },
			];

			expect(parseStructuredValue(toolCalls)).toEqual({
				kind: "json",
				value: toolCalls,
			});
		});

		it("does not treat role-less arrays as a conversation", () => {
			expect(parseStructuredValue('[{"content":"doc"}]').kind).toBe("json");
			expect(parseStructuredValue("[1,2]").kind).toBe("json");
			expect(parseStructuredValue({ a: 1 }).kind).toBe("json");
		});

		it("falls back to raw for truncated JSON", () => {
			expect(parseStructuredValue('[{"role":"user","par')).toEqual({ kind: "raw" });
		});

		it("treats everything else as text", () => {
			expect(parseStructuredValue("plain prose").kind).toBe("text");
			expect(parseStructuredValue(42).kind).toBe("text");
			expect(parseStructuredValue(null).kind).toBe("text");
		});
	});

	it("stringifies values, showing a dash for empty ones", () => {
		expect(stringifyValue("")).toBe("-");
		expect(stringifyValue(false)).toBe("false");
		expect(stringifyValue({ a: 1 })).toBe('{\n  "a": 1\n}');
	});
});
