/**
 * @jest-environment node
 */
jest.mock("@/lib/platform/realtime/rules", () => ({
	getActiveRealtimeRules: jest.fn(async () => [{ id: "builtin.error_rate" }]),
}));
jest.mock("@/lib/platform/realtime/findings", () => {
	class RealtimeFindingError extends Error {
		constructor(message: string, readonly status: number) {
			super(message);
		}
	}
	return {
		RealtimeFindingError,
		parseRealtimeFindingInput: jest.fn((body) => body),
		recordRealtimeFinding: jest.fn(async () => ({ transition: "opened", finding: { id: "f1" } })),
	};
});

import { NextRequest } from "next/server";
import { GET as getRules } from "@/app/api/internal/realtime/rules/route";
import { POST as postFinding } from "@/app/api/internal/realtime/findings/route";
import { recordRealtimeFinding, RealtimeFindingError } from "@/lib/platform/realtime/findings";

function request(method: string, path: string, { body, cron }: { body?: string; cron?: string } = {}) {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (cron !== undefined) headers["x-cron-job"] = cron;
	return new NextRequest(`http://localhost${path}`, { method, headers, body });
}

describe("internal realtime routes", () => {
	const original = process.env.CRON_JOB_SECRET;
	beforeEach(() => {
		process.env.CRON_JOB_SECRET = "s3cret";
		jest.clearAllMocks();
	});
	afterAll(() => {
		if (original === undefined) delete process.env.CRON_JOB_SECRET;
		else process.env.CRON_JOB_SECRET = original;
	});

	it("rules: rejects requests without the cron secret", async () => {
		expect((await getRules(request("GET", "/api/internal/realtime/rules"))).status).toBe(403);
		expect((await getRules(request("GET", "/api/internal/realtime/rules", { cron: "true" }))).status).toBe(403);
	});

	it("rules: returns the active rule set", async () => {
		const res = await getRules(request("GET", "/api/internal/realtime/rules", { cron: "s3cret" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ rules: [{ id: "builtin.error_rate" }] });
	});

	it("findings: rejects requests without the cron secret", async () => {
		const res = await postFinding(request("POST", "/api/internal/realtime/findings", { body: "{}" }));
		expect(res.status).toBe(403);
		expect(recordRealtimeFinding).not.toHaveBeenCalled();
	});

	it("findings: returns 400 for malformed JSON", async () => {
		const res = await postFinding(request("POST", "/api/internal/realtime/findings", { body: "{not json", cron: "s3cret" }));
		expect(res.status).toBe(400);
	});

	it("findings: records a valid finding", async () => {
		const res = await postFinding(request("POST", "/api/internal/realtime/findings", { body: "{}", cron: "s3cret" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ transition: "opened", id: "f1" });
	});

	it("findings: maps domain errors to their status", async () => {
		(recordRealtimeFinding as jest.Mock).mockRejectedValueOnce(new RealtimeFindingError("conflict", 409));
		const res = await postFinding(request("POST", "/api/internal/realtime/findings", { body: "{}", cron: "s3cret" }));
		expect(res.status).toBe(409);
	});
});
