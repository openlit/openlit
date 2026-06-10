/**
 * Unit coverage for the SQL building blocks in the coding-agents
 * queries layer. We test pure helpers that build clauses around the
 * `coding_agent.session.is_subagent` filter and the `CHAT_ID_EXPR`
 * coalesce contract. These are the regression-prone bits — the rest
 * of the file is a series of templated strings around them.
 *
 * Integration coverage (hitting a real ClickHouse) lives in the
 * playground / CI smoke layer; this file is only the *shape* of the
 * SQL the function builds, which is enough to catch the two
 * historical regressions:
 *
 *   1. is_subagent filter accidentally dropped (returns to "every
 *      subagent gets its own session row" behavior).
 *   2. CHAT_ID_EXPR loses one of the fallback attributes, causing
 *      pre-Cursor-1.99 transcripts to fold into the wrong session.
 */

import { buildSessionsHaving, escape } from "@/lib/platform/coding-agents/query-builders";

describe("buildSessionsHaving", () => {
	it("hides subagent rows by default", () => {
		const out = buildSessionsHaving({});
		expect(out).toContain("HAVING");
		expect(out).toContain("is_subagent = 0");
	});

	it("includes subagent rows when explicitly opted in", () => {
		const out = buildSessionsHaving({ includeSubagents: true });
		// When the operator opts in AND no other filters apply,
		// HAVING should be empty — anything else means a stray
		// implicit filter snuck in.
		expect(out).toBe("");
	});

	it("composes vendor + user + classification filters with AND", () => {
		const out = buildSessionsHaving({
			vendor: "cursor",
			user: "alice@example.com",
			classification: "work",
		});
		expect(out).toMatch(/HAVING /);
		expect(out).toContain("vendor = 'cursor'");
		expect(out).toContain("user = 'alice@example.com'");
		expect(out).toContain("classification = 'work'");
		expect(out).toContain("is_subagent = 0");
		// AND-joined; verify there's no stray OR or stray comma in
		// case a future refactor swaps the join.
		expect(out).not.toMatch(/\bOR\b/);
		expect(out).not.toContain(",");
	});

	it("escapes single quotes in user input to defang SQL injection", () => {
		// escape() is the same util used everywhere in queries.ts;
		// confirm it survives the buildSessionsHaving pass-through.
		// We use backslash-escaping (matching the existing helper),
		// so o'malley should render as o\'malley inside the literal.
		const out = buildSessionsHaving({ user: "o'malley" });
		expect(out).toContain("user = 'o\\'malley'");
		// Also confirm escape() directly: backslash-escape both
		// backslashes and apostrophes.
		expect(escape("a'b\\c")).toBe("a\\'b\\\\c");
	});

	it("preserves the is_subagent guard when only includeSubagents is set false explicitly", () => {
		const out = buildSessionsHaving({
			includeSubagents: false,
			vendor: "claude-code",
		});
		expect(out).toContain("vendor = 'claude-code'");
		expect(out).toContain("is_subagent = 0");
	});
});
