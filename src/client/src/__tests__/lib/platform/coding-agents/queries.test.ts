/**
 * Unit coverage for the coding-agents queries layer.
 *
 * Pure SQL builders (`buildSessionsHaving`) are tested for clause
 * shape; the exported ClickHouse helpers are exercised with a mocked
 * `dataCollector` so we cover entry points, pagination modes, cohort
 * floor behaviour, and dispute error paths without hitting a real DB.
 */

import { dataCollector } from "@/lib/platform/common";
import {
	DisputeError,
	getCodingSessionDigest,
	getCodingUserDigest,
	listCodingUsers,
	listSessions,
	submitClassificationDispute,
	writeAuditLog,
} from "@/lib/platform/coding-agents/queries";
import { buildSessionsHaving, escape } from "@/lib/platform/coding-agents/query-builders";
import type { CodingAgentAuth } from "@/lib/platform/coding-agents/auth";

jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
}));

jest.mock("@/clickhouse/migrations/create-coding-agents-audit-migration", () => ({
	CODING_AGENT_AUDIT_LOG_TABLE: "coding_agent_audit_log",
	CODING_AGENT_DISPUTES_TABLE: "coding_agent_disputes",
}));

const mockDataCollector = jest.mocked(dataCollector);

const auth: CodingAgentAuth = {
	userId: "user-1",
	organizationId: "org-1",
	role: "admin",
	rawRole: "admin",
};

const viewerAuth: CodingAgentAuth = {
	userId: "viewer-1",
	organizationId: "org-1",
	role: "viewer",
	rawRole: "member",
};

describe("buildSessionsHaving", () => {
	it("hides subagent rows by default", () => {
		const out = buildSessionsHaving({});
		expect(out).toContain("HAVING");
		expect(out).toContain("is_subagent = 0");
	});

	it("documents that parent chats with folded subagents stay visible", () => {
		// Regression lock: is_subagent = 0 must remain the default hide
		// predicate. The SQL that *computes* is_subagent (in queries.ts)
		// ignores Cursor self-parent_id echoes so a parent chat that
		// absorbed Task/subagent spans is NOT classified as is_subagent=1.
		// This HAVING clause is what the Sessions tab applies after that.
		const out = buildSessionsHaving({ vendor: "cursor" });
		expect(out).toMatch(/HAVING[\s\S]*is_subagent = 0/);
		expect(out).toContain("vendor = 'cursor'");
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

describe("coding agent query service", () => {
	const originalOrgFilter = process.env.OPENLIT_REQUIRE_ORG_FILTER;

	beforeEach(() => {
		jest.clearAllMocks();
		delete process.env.OPENLIT_REQUIRE_ORG_FILTER;
		Object.defineProperty(global, "crypto", {
			value: { randomUUID: jest.fn(() => "dispute-1") },
			configurable: true,
		});
	});

	afterAll(() => {
		if (originalOrgFilter === undefined) {
			delete process.env.OPENLIT_REQUIRE_ORG_FILTER;
		} else {
			process.env.OPENLIT_REQUIRE_ORG_FILTER = originalOrgFilter;
		}
	});

	it("lists sessions with cursor pagination and total count", async () => {
		mockDataCollector
			.mockResolvedValueOnce({
				err: null,
				data: [
					{ session_id: "s1", started_at: "2026-01-02T00:00:00Z", user: "u1" },
					{ session_id: "s2", started_at: "2026-01-01T00:00:00Z", user: "u2" },
				],
			})
			.mockResolvedValueOnce({ err: null, data: [{ total: "12" }] });

		await expect(
			listSessions(auth, {
				limit: 1,
				withTotal: true,
				vendor: "cursor",
				user: "u1",
				classification: "work",
			})
		).resolves.toEqual({
			rows: [{ session_id: "s1", started_at: "2026-01-02T00:00:00Z", user: "u1" }],
			nextCursor: "2026-01-02T00:00:00Z",
			total: 12,
		});

		expect(mockDataCollector).toHaveBeenCalledTimes(2);
		expect(mockDataCollector.mock.calls[0][0]).toMatchObject({
			query: expect.stringContaining("LIMIT 2"),
		});
	});

	it("lists sessions with offset pagination, sort, and time bounds", async () => {
		process.env.OPENLIT_REQUIRE_ORG_FILTER = "1";
		const since = new Date("2026-01-01T00:00:00.000Z");
		const until = new Date("2026-01-31T00:00:00.000Z");
		mockDataCollector.mockResolvedValueOnce({
			err: null,
			data: [
				{ session_id: "s1", started_at: "2026-01-02T00:00:00Z", user: "u1" },
			],
		});

		const result = await listSessions(auth, {
			offset: 10,
			limit: 25,
			sortBy: "cost",
			sortDir: "asc",
			since,
			until,
			cursor: "ignored-when-offset",
		});

		expect(result).toEqual({
			rows: [{ session_id: "s1", started_at: "2026-01-02T00:00:00Z", user: "u1" }],
			nextCursor: null,
			total: null,
		});

		const query = mockDataCollector.mock.calls[0][0].query as string;
		expect(query).toContain("OFFSET 10");
		expect(query).toContain("ORDER BY cost_usd ASC");
		expect(query).toContain("2026-01-01T00:00:00.000Z");
		expect(query).toContain("2026-01-31T00:00:00.000Z");
		expect(query).toContain("openlit.organization.id");
		expect(query).toContain("org-1");
		expect(query).not.toContain("ignored-when-offset");
	});

	it("lists sessions with a cursor clause and no next page", async () => {
		mockDataCollector.mockResolvedValueOnce({
			err: null,
			data: [{ session_id: "s1", started_at: "2026-01-01T00:00:00Z", user: "u1" }],
		});

		await expect(
			listSessions(auth, { cursor: "2026-01-05T00:00:00Z", limit: 50 })
		).resolves.toEqual({
			rows: [{ session_id: "s1", started_at: "2026-01-01T00:00:00Z", user: "u1" }],
			nextCursor: null,
			total: null,
		});

		expect(mockDataCollector.mock.calls[0][0].query).toContain(
			"WHERE started_at < '2026-01-05T00:00:00Z'"
		);
	});

	it("falls back to default sort columns for unknown sortBy values", async () => {
		mockDataCollector.mockResolvedValueOnce({
			err: null,
			data: [{ session_id: "s1", started_at: "2026-01-01T00:00:00Z", user: "u1" }],
		});
		await listSessions(auth, {
			offset: 0,
			limit: 10,
			sortBy: "not-a-real-column" as any,
		});
		expect(mockDataCollector.mock.calls[0][0].query).toContain(
			"ORDER BY started_at DESC"
		);

		mockDataCollector.mockResolvedValueOnce({ err: null, data: [] });
		await listCodingUsers(auth, {
			sortBy: "not-a-real-column" as any,
		});
		expect(mockDataCollector.mock.calls[1][0].query).toMatch(
			/ORDER BY\s+last_seen\s+DESC/
		);
	});

	it("skips cohort lookup when all users are unknown/low_cohort", async () => {
		mockDataCollector.mockResolvedValueOnce({
			err: null,
			data: [
				{ session_id: "s1", started_at: "2026-01-02T00:00:00Z", user: "unknown" },
				{ session_id: "s2", started_at: "2026-01-01T00:00:00Z", user: "low_cohort" },
			],
		});

		const result = await listSessions(viewerAuth, { limit: 10 });
		expect(result.rows).toHaveLength(2);
		expect(mockDataCollector).toHaveBeenCalledTimes(1);
	});

	it("applies the cohort floor for non-admin session lists", async () => {
		mockDataCollector
			.mockResolvedValueOnce({
				err: null,
				data: [
					{ session_id: "s1", started_at: "2026-01-02T00:00:00Z", user: "alice" },
					{ session_id: "s2", started_at: "2026-01-01T00:00:00Z", user: "unknown" },
				],
			})
			.mockResolvedValueOnce({
				err: null,
				data: [{ user: "alice", sessions: 2 }],
			});

		const result = await listSessions(viewerAuth, { limit: 10 });
		expect(result.rows).toEqual([
			{ session_id: "s1", started_at: "2026-01-02T00:00:00Z", user: "low_cohort" },
			{ session_id: "s2", started_at: "2026-01-01T00:00:00Z", user: "unknown" },
		]);
		expect(mockDataCollector.mock.calls[1][0].query).toContain("alice");
	});

	it("throws when listSessions dataCollector fails", async () => {
		mockDataCollector.mockResolvedValueOnce({
			err: new Error("clickhouse down"),
			data: [],
		});

		await expect(listSessions(auth)).rejects.toThrow("clickhouse down");
	});

	it("lists users and normalizes numeric fields", async () => {
		mockDataCollector
			.mockResolvedValueOnce({ err: null, data: [{ total: "1" }] })
			.mockResolvedValueOnce({
				err: null,
				data: [
					{
						user: "alice@example.com",
						last_seen: "2026-01-01T00:00:00Z",
						session_count: "3",
						tool_call_count: "7",
						cost_usd: "1.25",
						total_tokens: "1000",
						top_vendor: "cursor",
						classification_work: "2",
						classification_personal: "1",
						lines_added: "10",
						lines_accepted: "8",
						lines_rejected: "2",
						acceptance_pct: "80",
						commit_count: "1",
						pr_count: "1",
					},
				],
			});

		await expect(
			listCodingUsers(auth, {
				withTotal: true,
				vendor: "cursor",
				sortBy: "tokens",
				sortDir: "asc",
			})
		).resolves.toEqual({
			rows: [
				expect.objectContaining({
					user: "alice@example.com",
					session_count: 3,
					tool_call_count: 7,
					cost_usd: 1.25,
					total_tokens: 1000,
					classification_work: 2,
					classification_personal: 1,
					lines_added: 10,
					lines_accepted: 8,
					lines_rejected: 2,
					acceptance_pct: 80,
					commit_count: 1,
					pr_count: 1,
				}),
			],
			total: 1,
		});
	});

	it("lists users for viewers without a total query", async () => {
		mockDataCollector.mockResolvedValueOnce({
			err: null,
			data: [{ user: "low_cohort", session_count: "1", acceptance_pct: "0" }],
		});

		const result = await listCodingUsers(viewerAuth, { limit: 10 });
		expect(result.total).toBeNull();
		expect(result.rows[0]).toMatchObject({ user: "low_cohort", session_count: 1 });
		expect(mockDataCollector).toHaveBeenCalledTimes(1);
		expect(mockDataCollector.mock.calls[0][0].query).toContain("low_cohort");
	});

	it("throws when listCodingUsers dataCollector fails", async () => {
		mockDataCollector.mockResolvedValueOnce({
			err: new Error("users query failed"),
			data: [],
		});

		await expect(listCodingUsers(auth)).rejects.toThrow("users query failed");
	});

	it("returns null for empty or missing session digests", async () => {
		await expect(getCodingSessionDigest(auth, "")).resolves.toBeNull();

		mockDataCollector.mockResolvedValueOnce({ err: null, data: [] });
		await expect(getCodingSessionDigest(auth, "s1")).resolves.toBeNull();
	});

	it("normalizes session digest rows", async () => {
		mockDataCollector.mockResolvedValueOnce({
			err: null,
			data: [
				{
					session_id: "s1",
					lines_added: "12",
					lines_removed: "2",
					lines_accepted: "8",
					lines_rejected: "2",
					edit_accept_count: "4",
					edit_reject_count: "1",
					commit_count: "2",
					pr_count: "1",
					total_tokens: "100",
					input_tokens: "40",
					output_tokens: "60",
					cost_usd: "0.5",
					duration_ms: "3000",
					model: "gpt-4.1",
					repo_url: "https://github.com/openlit/openlit",
					branch: "main",
					working_dir: "/repo/openlit",
					working_dir_label: "repo/openlit",
				},
			],
		});

		await expect(getCodingSessionDigest(auth, "s1")).resolves.toEqual({
			session_id: "s1",
			lines_added: 12,
			lines_removed: 2,
			lines_accepted: 8,
			lines_rejected: 2,
			edit_accept_count: 4,
			edit_reject_count: 1,
			commit_count: 2,
			pr_count: 1,
			acceptance_pct: 80,
			total_tokens: 100,
			input_tokens: 40,
			output_tokens: 60,
			cost_usd: 0.5,
			duration_ms: 3000,
			model: "gpt-4.1",
			repo_url: "https://github.com/openlit/openlit",
			branch: "main",
			working_dir: "/repo/openlit",
			working_dir_label: "repo/openlit",
		});
	});

	it("returns acceptance_pct 0 when there are no edit decisions", async () => {
		mockDataCollector.mockResolvedValueOnce({
			err: null,
			data: [
				{
					session_id: "s1",
					edit_accept_count: 0,
					edit_reject_count: 0,
					lines_added: 0,
					lines_removed: 0,
					lines_accepted: 0,
					lines_rejected: 0,
					commit_count: 0,
					pr_count: 0,
					total_tokens: 0,
					input_tokens: 0,
					output_tokens: 0,
					cost_usd: 0,
					duration_ms: 0,
					model: "",
				},
			],
		});

		await expect(getCodingSessionDigest(auth, "s1")).resolves.toMatchObject({
			acceptance_pct: 0,
			edit_accept_count: 0,
			edit_reject_count: 0,
		});
	});

	it("hides session digests below the cohort floor for viewers", async () => {
		mockDataCollector
			.mockResolvedValueOnce({
				err: null,
				data: [
					{
						session_id: "s1",
						user: "alice",
						edit_accept_count: 0,
						edit_reject_count: 0,
					},
				],
			})
			.mockResolvedValueOnce({ err: null, data: [{ sessions: 2 }] });

		await expect(getCodingSessionDigest(viewerAuth, "s1")).resolves.toBeNull();
	});

	it("returns session digests for viewers above the cohort floor", async () => {
		mockDataCollector
			.mockResolvedValueOnce({
				err: null,
				data: [
					{
						session_id: "s1",
						user: "alice",
						edit_accept_count: "1",
						edit_reject_count: "1",
						lines_added: 0,
					},
				],
			})
			.mockResolvedValueOnce({ err: null, data: [{ sessions: 5 }] });

		await expect(getCodingSessionDigest(viewerAuth, "s1")).resolves.toMatchObject({
			session_id: "s1",
			acceptance_pct: 50,
		});
	});

	it("fails closed when session cohort lookup errors", async () => {
		const errorSpy = jest.spyOn(console, "error").mockImplementation();
		mockDataCollector
			.mockResolvedValueOnce({
				err: null,
				data: [{ session_id: "s1", user: "alice", edit_accept_count: 1 }],
			})
			.mockResolvedValueOnce({ err: new Error("cohort failed"), data: [] });

		await expect(getCodingSessionDigest(viewerAuth, "s1")).resolves.toBeNull();
		expect(errorSpy).toHaveBeenCalledWith(
			"coding_agent.session.cohort_lookup_failed",
			expect.any(Error)
		);
		errorSpy.mockRestore();
	});

	it("throws when getCodingSessionDigest dataCollector fails", async () => {
		mockDataCollector.mockResolvedValueOnce({
			err: new Error("digest failed"),
			data: [],
		});

		await expect(getCodingSessionDigest(auth, "s1")).rejects.toThrow(
			"digest failed"
		);
	});

	it("returns null for empty user digests", async () => {
		await expect(getCodingUserDigest(auth, "")).resolves.toBeNull();

		mockDataCollector
			.mockResolvedValueOnce({ err: null, data: [] })
			.mockResolvedValueOnce({ err: null, data: [] });
		await expect(getCodingUserDigest(auth, "alice")).resolves.toBeNull();
	});

	it("normalizes user digests and top vendors", async () => {
		mockDataCollector
			.mockResolvedValueOnce({
				err: null,
				data: [
					{
						user: "alice",
						first_seen: "2026-01-01T00:00:00Z",
						last_seen: "2026-01-02T00:00:00Z",
						session_count: "6",
						tool_call_count: "12",
						cost_usd: "1.5",
						classification_work: "4",
						classification_personal: "1",
						classification_disputed: "0",
						classification_unknown: "1",
						lines_added: "20",
						lines_removed: "5",
						lines_accepted: "15",
						lines_rejected: "5",
						edit_accept_count: "3",
						edit_reject_count: "1",
						commit_count: "2",
						pr_count: "1",
						acceptance_pct: "75",
					},
				],
			})
			.mockResolvedValueOnce({
				err: null,
				data: [{ vendor: "cursor", sessions: "4" }],
			});

		await expect(getCodingUserDigest(auth, "alice")).resolves.toEqual({
			user: "alice",
			first_seen: "2026-01-01T00:00:00Z",
			last_seen: "2026-01-02T00:00:00Z",
			session_count: 6,
			tool_call_count: 12,
			cost_usd: 1.5,
			classification_work: 4,
			classification_personal: 1,
			classification_disputed: 0,
			classification_unknown: 1,
			lines_added: 20,
			lines_removed: 5,
			lines_accepted: 15,
			lines_rejected: 5,
			edit_accept_count: 3,
			edit_reject_count: 1,
			commit_count: 2,
			pr_count: 1,
			acceptance_pct: 75,
			top_vendors: [{ vendor: "cursor", sessions: 4 }],
		});

		expect(mockDataCollector.mock.calls[0][0].query).toContain("alice");
		expect(mockDataCollector.mock.calls[1][0].query).toContain("GROUP BY vendor");
	});

	it("hides user digests below the cohort floor for viewers", async () => {
		mockDataCollector
			.mockResolvedValueOnce({
				err: null,
				data: [{ user: "alice", session_count: "2", acceptance_pct: 0 }],
			})
			.mockResolvedValueOnce({ err: null, data: [] });

		await expect(getCodingUserDigest(viewerAuth, "alice")).resolves.toBeNull();
	});

	it("throws when getCodingUserDigest dataCollector fails", async () => {
		mockDataCollector
			.mockResolvedValueOnce({ err: new Error("user digest failed"), data: [] })
			.mockResolvedValueOnce({ err: null, data: [] });

		await expect(getCodingUserDigest(auth, "alice")).rejects.toThrow(
			"user digest failed"
		);
	});

	it("submits classification disputes and audit logs", async () => {
		mockDataCollector
			.mockResolvedValueOnce({ err: null, data: [{ hit: 1 }] })
			.mockResolvedValueOnce({ err: null, data: [] })
			.mockResolvedValueOnce({ err: null, data: [{ n: 0 }] })
			.mockResolvedValueOnce({ err: null, data: [] })
			.mockResolvedValueOnce({ err: null, data: [] });

		await expect(
			submitClassificationDispute(auth, {
				sessionId: "s1",
				currentClassification: "work",
				requestedClassification: "personal",
				rationale: "Personal experiment.",
			})
		).resolves.toEqual({ id: "dispute-1" });

		expect(mockDataCollector).toHaveBeenLastCalledWith(
			expect.objectContaining({
				values: [
					expect.objectContaining({
						action: "coding_agent.classification.dispute",
						subject: "s1",
					}),
				],
			}),
			"insert"
		);
	});

	it.each([
		[[{ err: null, data: [] }], "not_found", 404],
		[
			[
				{ err: null, data: [{ hit: 1 }] },
				{ err: null, data: [{ hit: 1 }] },
			],
			"duplicate",
			409,
		],
		[
			[
				{ err: null, data: [{ hit: 1 }] },
				{ err: null, data: [] },
				{ err: null, data: [{ n: 20 }] },
			],
			"rate_limited",
			429,
		],
		// Fail-closed lookup errors map to the same user-facing codes.
		[[{ err: new Error("lookup failed"), data: [] }], "not_found", 404],
		[
			[
				{ err: null, data: [{ hit: 1 }] },
				{ err: new Error("dedupe failed"), data: [] },
			],
			"duplicate",
			409,
		],
		[
			[
				{ err: null, data: [{ hit: 1 }] },
				{ err: null, data: [] },
				{ err: new Error("rate failed"), data: [] },
			],
			"rate_limited",
			429,
		],
	])(
		"throws %s dispute errors",
		async (responses, code, status) => {
			const errorSpy = jest.spyOn(console, "error").mockImplementation();
			for (const response of responses) {
				mockDataCollector.mockResolvedValueOnce(response as any);
			}

			await expect(
				submitClassificationDispute(auth, {
					sessionId: "s1",
					currentClassification: "work",
					requestedClassification: "personal",
					rationale: "Personal experiment.",
				})
			).rejects.toMatchObject({ code, status });
			errorSpy.mockRestore();
		}
	);

	it("throws when dispute insert fails", async () => {
		mockDataCollector
			.mockResolvedValueOnce({ err: null, data: [{ hit: 1 }] })
			.mockResolvedValueOnce({ err: null, data: [] })
			.mockResolvedValueOnce({ err: null, data: [{ n: 0 }] })
			.mockResolvedValueOnce({ err: new Error("insert failed"), data: [] });

		await expect(
			submitClassificationDispute(auth, {
				sessionId: "s1",
				currentClassification: "work",
				requestedClassification: "personal",
				rationale: "Personal experiment.",
			})
		).rejects.toThrow("insert failed");
	});

	it("swallows audit log insert failures", async () => {
		const errorSpy = jest.spyOn(console, "error").mockImplementation();
		mockDataCollector.mockResolvedValueOnce({
			err: new Error("insert failed"),
			data: [],
		});

		await expect(
			writeAuditLog(auth, {
				action: "coding_agent.test",
				subject: "s1",
			})
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledWith(
			"coding_agent.audit_log.insert_failed",
			expect.any(Error)
		);
		errorSpy.mockRestore();
	});
});

describe("DisputeError", () => {
	it("carries status and machine-readable codes", () => {
		const error = new DisputeError("duplicate", 409, "Duplicate");

		expect(error).toBeInstanceOf(Error);
		expect(error.code).toBe("duplicate");
		expect(error.status).toBe(409);
		expect(error.message).toBe("Duplicate");
	});
});
