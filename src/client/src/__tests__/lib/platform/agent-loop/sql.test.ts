import {
	TOOL_NAME_SQL,
	IS_TOOL_SPAN_SQL,
	ARGS_FINGERPRINT_SQL,
	GROUP_KEY_SQL,
	SPAN_COST_SQL,
	SPAN_TOKENS_SQL,
	agentLoopToolRowsSql,
	agentLoopGroupsSql,
	agentLoopWhereSql,
	agentLoopStatsSql,
	agentLoopHitsByTraceSql,
	agentLoopHitsByGroupSql,
} from "@/lib/platform/agent-loop/sql";

describe("SQL fragment constants", () => {
	it("builds a trimmed tool-name fallback chain", () => {
		expect(TOOL_NAME_SQL).toContain("gen_ai.tool.name");
		expect(TOOL_NAME_SQL).toContain("gen_ai.tool.call.name");
		expect(TOOL_NAME_SQL).toMatch(/^trim\(BOTH ' ' FROM/);
	});

	it("derives IS_TOOL_SPAN_SQL from the tool name fragment", () => {
		expect(IS_TOOL_SPAN_SQL).toBe(`notEmpty(${TOOL_NAME_SQL})`);
	});

	it("builds an args fingerprint that collapses whitespace", () => {
		expect(ARGS_FINGERPRINT_SQL).toContain("gen_ai.tool.args");
		expect(ARGS_FINGERPRINT_SQL).toContain("replaceRegexpAll");
	});

	it("builds a group key that prefers conversation, then session, then trace", () => {
		expect(GROUP_KEY_SQL).toContain("'c:'");
		expect(GROUP_KEY_SQL).toContain("'s:'");
		expect(GROUP_KEY_SQL).toContain("'t:'");
		expect(GROUP_KEY_SQL).toContain("TraceId");
	});

	it("builds cost and token aggregation fragments", () => {
		expect(SPAN_COST_SQL).toContain("gen_ai.usage.cost");
		expect(SPAN_TOKENS_SQL).toContain("gen_ai.usage.total_tokens");
		expect(SPAN_TOKENS_SQL).toContain("gen_ai.usage.input_tokens");
		expect(SPAN_TOKENS_SQL).toContain("gen_ai.usage.output_tokens");
	});
});

describe("agentLoopToolRowsSql", () => {
	it("filters by base where and tool-span predicate", () => {
		const sql = agentLoopToolRowsSql("otel_traces", "Timestamp >= now() - 1");
		expect(sql).toContain("FROM otel_traces");
		expect(sql).toContain("Timestamp >= now() - 1");
		expect(sql).toContain(IS_TOOL_SPAN_SQL);
	});

	it("omits an empty base where clause from the AND chain", () => {
		const sql = agentLoopToolRowsSql("otel_traces", "");
		expect(sql).not.toContain("AND " + IS_TOOL_SPAN_SQL);
		expect(sql).toContain(`WHERE ${IS_TOOL_SPAN_SQL}`);
	});
});

describe("agentLoopGroupsSql", () => {
	it("uses the default threshold when not provided", () => {
		const sql = agentLoopGroupsSql("otel_traces", "1=1");
		expect(sql).toContain("HAVING count() >= 3");
	});

	it("honors a custom threshold", () => {
		const sql = agentLoopGroupsSql("otel_traces", "1=1", 5);
		expect(sql).toContain("HAVING count() >= 5");
	});
});

describe("agentLoopWhereSql", () => {
	it("wraps the groups/rows join in a TraceId IN(...) predicate", () => {
		const sql = agentLoopWhereSql("otel_traces", "1=1");
		expect(sql).toMatch(/^TraceId IN \(/);
		expect(sql).toContain("INNER JOIN");
	});
});

describe("agentLoopStatsSql", () => {
	it("aggregates tool trace and loop counts", () => {
		const sql = agentLoopStatsSql("otel_traces", "1=1", 4);
		expect(sql).toContain("uniqExact(TraceId) AS tool_traces");
		expect(sql).toContain("uniqExactIf(TraceId");
		expect(sql).toContain("HAVING count() >= 4");
	});

	it("defaults to the standard threshold", () => {
		const sql = agentLoopStatsSql("otel_traces", "1=1");
		expect(sql).toContain("HAVING count() >= 3");
	});
});

describe("agentLoopHitsByTraceSql", () => {
	it("filters by the provided trace ids and escapes quotes/backslashes", () => {
		const sql = agentLoopHitsByTraceSql("otel_traces", "1=1", ["t-1", "t'2", "t\\3"]);
		expect(sql).toContain("WHERE tool_rows.TraceId IN ('t-1', 't\\'2', 't\\\\3')");
		expect(sql).toContain("GROUP BY TraceId");
	});

	it("honors a custom threshold", () => {
		const sql = agentLoopHitsByTraceSql("otel_traces", "1=1", ["t-1"], 7);
		expect(sql).toContain("HAVING count() >= 7");
	});

	it("produces an empty id list for an empty trace id array", () => {
		const sql = agentLoopHitsByTraceSql("otel_traces", "1=1", []);
		expect(sql).toContain("WHERE tool_rows.TraceId IN ()");
	});
});

describe("agentLoopHitsByGroupSql", () => {
	it("expands each group id into conversation and session key variants", () => {
		const sql = agentLoopHitsByGroupSql("otel_traces", "1=1", ["group-1"]);
		expect(sql).toContain("'c:group-1'");
		expect(sql).toContain("'s:group-1'");
		expect(sql).toContain("substring(group_key, 3) AS groupId");
	});

	it("escapes quotes/backslashes in group ids", () => {
		const sql = agentLoopHitsByGroupSql("otel_traces", "1=1", ["g'1", "g\\2"]);
		expect(sql).toContain("'c:g\\'1'");
		expect(sql).toContain("'s:g\\\\2'");
	});

	it("returns a short-circuit empty-result query when there are no group ids", () => {
		const sql = agentLoopHitsByGroupSql("otel_traces", "1=1", []);
		expect(sql).toBe(
			"SELECT '' AS groupId, '' AS toolName, 0 AS count, 0 AS wastedTokens, 0 AS wastedCost WHERE 0"
		);
	});

	it("honors a custom threshold", () => {
		const sql = agentLoopHitsByGroupSql("otel_traces", "1=1", ["group-1"], 9);
		expect(sql).toContain("HAVING count() >= 9");
	});
});
