import {
	AGENT_LOOP_THRESHOLD,
	asAgentLoopHit,
	collapseWhitespace,
	conversationGroupKey,
	detectAgentLoops,
	fingerprintToolArgs,
	hasAgentLoopFilter,
	listedSpansMatchingAgentLoop,
	loopGroupIdentity,
	loopHitsByTraceId,
	spanCostOf,
	spanLoopAttrs,
	spanTokensOf,
	spanTraceId,
	uniqueTraceCount,
	worstLoop,
} from "@/lib/platform/agent-loop/classify";
import { agentLoopWhereSql } from "@/lib/platform/agent-loop/sql";

function toolSpan(
	traceId: string,
	tool: string,
	args: string,
	extras?: Record<string, unknown>
) {
	return {
		traceId,
		timestamp: extras?.timestamp as string | undefined,
		spanAttributes: {
			"gen_ai.tool.name": tool,
			"gen_ai.tool.args": args,
			"gen_ai.usage.total_tokens": extras?.tokens ?? "10",
			"gen_ai.usage.cost": extras?.cost ?? "0.01",
			...(extras?.conversation
				? { "gen_ai.conversation.id": extras.conversation }
				: {}),
			...(extras?.session
				? { "coding_agent.session.id": extras.session }
				: {}),
		},
	};
}

describe("hasAgentLoopFilter", () => {
	it("accepts boolean, 1, and loop chip arrays", () => {
		expect(hasAgentLoopFilter(true)).toBe(true);
		expect(hasAgentLoopFilter("1")).toBe(true);
		expect(hasAgentLoopFilter(["loop"])).toBe(true);
		expect(hasAgentLoopFilter(false)).toBe(false);
		expect(hasAgentLoopFilter([])).toBe(false);
		expect(hasAgentLoopFilter(undefined)).toBe(false);
	});

	it("accepts array items that are boolean true or the string 'true'", () => {
		expect(hasAgentLoopFilter([true])).toBe(true);
		expect(hasAgentLoopFilter(["true"])).toBe(true);
	});

	it("rejects arrays with no matching chip values", () => {
		expect(hasAgentLoopFilter(["other"])).toBe(false);
		expect(hasAgentLoopFilter([false, "0"])).toBe(false);
	});
});

describe("fingerprintToolArgs", () => {
	it("collapses whitespace without parsing JSON", () => {
		expect(fingerprintToolArgs('  {"q":"foo"}  ')).toBe('{"q":"foo"}');
		expect(fingerprintToolArgs("a   b")).toBe("a b");
		expect(collapseWhitespace(" a\n b ")).toBe("a b");
	});

	it("returns an empty string for undefined or null input", () => {
		expect(fingerprintToolArgs(undefined)).toBe("");
		expect(fingerprintToolArgs(null)).toBe("");
	});

	it("JSON-stringifies non-string input before collapsing whitespace", () => {
		expect(fingerprintToolArgs({ q: "foo" })).toBe('{"q":"foo"}');
	});
});

describe("spanLoopAttrs", () => {
	it("prefers lowercase attribute bags, falling back to capitalized ones", () => {
		expect(
			spanLoopAttrs({
				SpanAttributes: { a: 1 },
				ResourceAttributes: { b: 2 },
			})
		).toEqual({ a: 1, b: 2 });
	});

	it("returns an empty object when no attribute bags are present", () => {
		expect(spanLoopAttrs({})).toEqual({});
	});
});

describe("spanTraceId", () => {
	it("falls back to the capitalized TraceId field", () => {
		expect(spanTraceId({ TraceId: "t-cap" }, 2)).toBe("t-cap");
	});

	it("falls back to a synthetic span:index id when no trace id is present", () => {
		expect(spanTraceId({}, 5)).toBe("span:5");
	});
});

describe("conversationGroupKey", () => {
	it("prefers conversation id, then session id, then trace id", () => {
		expect(
			conversationGroupKey({ "gen_ai.conversation.id": "chat-1" }, "t-1")
		).toBe("c:chat-1");
		expect(
			conversationGroupKey({ "coding_agent.session.id": "sess-1" }, "t-1")
		).toBe("s:sess-1");
		expect(conversationGroupKey({ "session.id": "native-1" }, "t-1")).toBe(
			"s:native-1"
		);
		expect(conversationGroupKey({}, "t-1")).toBe("t:t-1");
	});

	it("returns an empty string when no attributes or trace id are present", () => {
		expect(conversationGroupKey({}, "")).toBe("");
		expect(conversationGroupKey(undefined, "")).toBe("");
	});
});

describe("spanCostOf / spanTokensOf number parsing", () => {
	it("treats non-numeric cost/token values as 0", () => {
		expect(spanCostOf({ "gen_ai.usage.cost": "not-a-number" })).toBe(0);
		expect(
			spanTokensOf({ "gen_ai.usage.total_tokens": "not-a-number" })
		).toBe(0);
	});
});

describe("detectAgentLoops", () => {
	it("flags the same tool and args at the threshold", () => {
		const loops = detectAgentLoops([
			toolSpan("t-1", "search", '{"q":"orders"}', { conversation: "c1" }),
			toolSpan("t-1", "search", '{"q":"orders"}', { conversation: "c1" }),
			toolSpan("t-1", "search", '{"q":"orders"}', { conversation: "c1" }),
		]);
		expect(loops).toHaveLength(1);
		expect(loops[0]).toMatchObject({
			toolName: "search",
			count: 3,
			groupKey: "c:c1",
		});
		expect(loops[0].wastedTokens).toBe(20);
		expect(loops[0].wastedCost).toBeCloseTo(0.02);
	});

	it("does not flag repeats when tool args are empty", () => {
		expect(
			detectAgentLoops([
				toolSpan("t-1", "Bash", "", { session: "sess-1" }),
				toolSpan("t-1", "Bash", "  ", { session: "sess-1" }),
				toolSpan("t-1", "Bash", "", { session: "sess-1" }),
			])
		).toHaveLength(0);
	});

	it("does not flag two repeats", () => {
		expect(
			detectAgentLoops([
				toolSpan("t-1", "search", '{"q":"orders"}'),
				toolSpan("t-1", "search", '{"q":"orders"}'),
			])
		).toHaveLength(0);
	});

	it("treats different args as different groups", () => {
		expect(
			detectAgentLoops([
				toolSpan("t-1", "search", '{"q":"a"}'),
				toolSpan("t-1", "search", '{"q":"a"}'),
				toolSpan("t-1", "search", '{"q":"b"}'),
			])
		).toHaveLength(0);
	});

	it("orders repeats by a valid ISO timestamp when present", () => {
		const loops = detectAgentLoops([
			toolSpan("t-1", "search", '{"q":"orders"}', {
				conversation: "c1",
				timestamp: "2026-01-01T00:00:02.000Z",
			}),
			toolSpan("t-1", "search", '{"q":"orders"}', {
				conversation: "c1",
				timestamp: "2026-01-01T00:00:01.000Z",
			}),
			toolSpan("t-1", "search", '{"q":"orders"}', {
				conversation: "c1",
				timestamp: "2026-01-01T00:00:03.000Z",
			}),
		]);
		expect(loops).toHaveLength(1);
		expect(loops[0].count).toBe(3);
	});

	it("treats an unparsable timestamp as 0 without throwing", () => {
		const loops = detectAgentLoops([
			toolSpan("t-1", "search", '{"q":"orders"}', {
				conversation: "c1",
				timestamp: "not-a-date",
			}),
			toolSpan("t-1", "search", '{"q":"orders"}', { conversation: "c1" }),
			toolSpan("t-1", "search", '{"q":"orders"}', { conversation: "c1" }),
		]);
		expect(loops).toHaveLength(1);
	});

	it("groups across traces that share a conversation id", () => {
		const loops = detectAgentLoops([
			toolSpan("t-1", "read_file", '{"path":"a.ts"}', {
				conversation: "chat",
			}),
			toolSpan("t-2", "read_file", '{"path":"a.ts"}', {
				conversation: "chat",
			}),
			toolSpan("t-3", "read_file", '{"path":"a.ts"}', {
				conversation: "chat",
			}),
		]);
		expect(loops[0].traceIds.sort()).toEqual(["t-1", "t-2", "t-3"]);
	});
});

describe("listedSpansMatchingAgentLoop", () => {
	it("returns one row per looping trace", () => {
		const spans = [
			{ traceId: "t-ok", spanAttributes: { "http.method": "GET" } },
			toolSpan("t-loop", "search", "{}"),
			toolSpan("t-loop", "search", "{}"),
			toolSpan("t-loop", "search", "{}"),
		];
		const listed = listedSpansMatchingAgentLoop(spans, true);
		expect(listed).toHaveLength(1);
		expect(listed[0].traceId).toBe("t-loop");
	});

	it("returns all spans when the filter is off", () => {
		const spans = [toolSpan("t-1", "search", "{}")];
		expect(listedSpansMatchingAgentLoop(spans, false)).toEqual(spans);
	});

	it("returns an empty array when enabled but no loops are detected", () => {
		const spans = [toolSpan("t-1", "search", "{}")];
		expect(listedSpansMatchingAgentLoop(spans, true)).toEqual([]);
	});
});

describe("loopHitsByTraceId", () => {
	it("keeps the worst loop per trace", () => {
		const hits = loopHitsByTraceId([
			toolSpan("t-1", "search", '{"q":"a"}'),
			toolSpan("t-1", "search", '{"q":"a"}'),
			toolSpan("t-1", "search", '{"q":"a"}'),
			toolSpan("t-1", "search", '{"q":"a"}'),
			toolSpan("t-1", "get_order", "{}"),
			toolSpan("t-1", "get_order", "{}"),
			toolSpan("t-1", "get_order", "{}"),
		]);
		expect(hits.get("t-1")?.toolName).toBe("search");
		expect(hits.get("t-1")?.count).toBe(4);
	});
});

describe("asAgentLoopHit", () => {
	it("rejects hits below the threshold", () => {
		expect(
			asAgentLoopHit({ toolName: "search", count: AGENT_LOOP_THRESHOLD - 1 })
		).toBeUndefined();
		expect(
			asAgentLoopHit({ toolName: "search", count: AGENT_LOOP_THRESHOLD })
		).toMatchObject({ toolName: "search", count: 3 });
	});

	it("rejects non-object values", () => {
		expect(asAgentLoopHit(null)).toBeUndefined();
		expect(asAgentLoopHit(undefined)).toBeUndefined();
		expect(asAgentLoopHit("search")).toBeUndefined();
	});

	it("rejects rows with a missing/blank tool name", () => {
		expect(asAgentLoopHit({ toolName: "", count: 5 })).toBeUndefined();
		expect(asAgentLoopHit({ count: 5 })).toBeUndefined();
	});

	it("rejects rows with a non-finite count", () => {
		expect(asAgentLoopHit({ toolName: "search", count: "abc" })).toBeUndefined();
	});

	it("defaults wastedTokens/wastedCost to 0 when not numeric", () => {
		expect(
			asAgentLoopHit({ toolName: "search", count: 5 })
		).toEqual({ toolName: "search", count: 5, wastedTokens: 0, wastedCost: 0 });
	});
});

describe("worstLoop", () => {
	it("returns undefined when there are no loops", () => {
		expect(worstLoop([])).toBeUndefined();
	});

	it("returns the top loop's hit summary when loops exist", () => {
		const loops = detectAgentLoops([
			toolSpan("t-1", "search", '{"q":"orders"}', { conversation: "c1" }),
			toolSpan("t-1", "search", '{"q":"orders"}', { conversation: "c1" }),
			toolSpan("t-1", "search", '{"q":"orders"}', { conversation: "c1" }),
		]);
		const hit = worstLoop(loops);
		expect(hit?.toolName).toBe("search");
		expect(hit?.count).toBe(3);
		expect(hit?.wastedTokens).toBe(20);
		expect(hit?.wastedCost).toBeCloseTo(0.02);
	});
});

describe("loopGroupIdentity", () => {
	it("prefers conversation id when present", () => {
		expect(
			loopGroupIdentity({ "gen_ai.conversation.id": "chat-1" })
		).toEqual({ key: "gen_ai.conversation.id", value: "chat-1" });
	});

	it("falls back to coding_agent.session.id", () => {
		expect(
			loopGroupIdentity({ "coding_agent.session.id": "sess-1" })
		).toEqual({ key: "coding_agent.session.id", value: "sess-1" });
	});

	it("falls back to generic session.id", () => {
		expect(loopGroupIdentity({ "session.id": "native-1" })).toEqual({
			key: "session.id",
			value: "native-1",
		});
	});

	it("returns undefined when no identity attribute is present", () => {
		expect(loopGroupIdentity({})).toBeUndefined();
		expect(loopGroupIdentity(undefined)).toBeUndefined();
	});
});

describe("spanTokensOf", () => {
	it("uses total tokens when present and positive", () => {
		expect(
			spanTokensOf({ "gen_ai.usage.total_tokens": "42" })
		).toBe(42);
	});

	it("falls back to input+output tokens when total is absent", () => {
		expect(
			spanTokensOf({
				"gen_ai.usage.input_tokens": "10",
				"gen_ai.usage.output_tokens": "5",
			})
		).toBe(15);
	});

	it("falls back to prompt/completion token aliases", () => {
		expect(
			spanTokensOf({
				"gen_ai.usage.prompt_tokens": "3",
				"gen_ai.usage.completion_tokens": "4",
			})
		).toBe(7);
	});

	it("returns 0 when no token attributes are present", () => {
		expect(spanTokensOf({})).toBe(0);
		expect(spanTokensOf(undefined)).toBe(0);
	});
});

describe("uniqueTraceCount", () => {
	it("counts distinct trace ids", () => {
		expect(
			uniqueTraceCount([
				{ traceId: "t-1" },
				{ traceId: "t-1" },
				{ TraceId: "t-2" },
			])
		).toBe(2);
	});

	it("falls back to span count when no trace ids are present", () => {
		expect(uniqueTraceCount([{}, {}])).toBe(2);
	});

	it("returns 0 for an empty span list", () => {
		expect(uniqueTraceCount([])).toBe(0);
	});
});

describe("agentLoopWhereSql", () => {
	it("groups tool spans by conversation, tool, and args fingerprint", () => {
		const sql = agentLoopWhereSql("otel_traces", "Timestamp >= now() - 1");
		expect(sql).toContain("TraceId IN");
		expect(sql).toContain("gen_ai.tool.name");
		expect(sql).toContain("gen_ai.conversation.id");
		expect(sql).toContain("coding_agent.session.id");
		expect(sql).toContain("session.id");
		expect(sql).toContain("HAVING count() >= 3");
		expect(sql).toContain("notEmpty(args_fp)");
		expect(sql).toContain("Timestamp >= now() - 1");
	});
});
