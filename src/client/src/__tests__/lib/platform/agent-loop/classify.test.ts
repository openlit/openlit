import {
	AGENT_LOOP_THRESHOLD,
	asAgentLoopHit,
	collapseWhitespace,
	conversationGroupKey,
	detectAgentLoops,
	fingerprintToolArgs,
	hasAgentLoopFilter,
	listedSpansMatchingAgentLoop,
	loopHitsByTraceId,
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
});

describe("fingerprintToolArgs", () => {
	it("collapses whitespace without parsing JSON", () => {
		expect(fingerprintToolArgs('  {"q":"foo"}  ')).toBe('{"q":"foo"}');
		expect(fingerprintToolArgs("a   b")).toBe("a b");
		expect(collapseWhitespace(" a\n b ")).toBe("a b");
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
});

describe("worstLoop", () => {
	it("returns undefined when there are no loops", () => {
		expect(worstLoop([])).toBeUndefined();
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
