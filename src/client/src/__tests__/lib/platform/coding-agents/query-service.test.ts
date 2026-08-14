import { dataCollector } from "@/lib/platform/common";
import {
	DisputeError,
	getCodingSessionDigest,
	listCodingUsers,
	listSessions,
	submitClassificationDispute,
	writeAuditLog,
} from "@/lib/platform/coding-agents/queries";
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

describe("coding agent query service", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		Object.defineProperty(global, "crypto", {
			value: { randomUUID: jest.fn(() => "dispute-1") },
			configurable: true,
		});
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
	])(
		"throws %s dispute errors",
		async (responses, code, status) => {
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
		}
	);

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
