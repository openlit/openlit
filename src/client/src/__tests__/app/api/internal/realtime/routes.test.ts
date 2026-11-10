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
		pruneRealtimeFindings: jest.fn(async () => 0),
		recordRealtimeFinding: jest.fn(async () => ({ transition: "opened", finding: { id: "f1" } })),
	};
});

import { NextRequest } from "next/server";
import { GET as getRules } from "@/app/api/internal/realtime/rules/route";
import { POST as postFinding } from "@/app/api/internal/realtime/findings/route";
import { recordRealtimeFinding, RealtimeFindingError } from "@/lib/platform/realtime/findings";

function request(
	method: string,
	path: string,
	{ body, secret, cron }: { body?: string; secret?: string; cron?: string } = {}
) {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (secret !== undefined) headers["x-openlit-engine-secret"] = secret;
	if (cron !== undefined) headers["x-cron-job"] = cron;
	return new NextRequest(`http://localhost${path}`, { method, headers, body });
}

describe("internal realtime routes", () => {
	const originalEngine = process.env.OPENLIT_ENGINE_SECRET;
	const originalCron = process.env.CRON_JOB_SECRET;
	beforeEach(() => {
		process.env.OPENLIT_ENGINE_SECRET = "s3cret";
		process.env.CRON_JOB_SECRET = "cron-s3cret";
		jest.clearAllMocks();
	});
	afterAll(() => {
		if (originalEngine === undefined) delete process.env.OPENLIT_ENGINE_SECRET;
		else process.env.OPENLIT_ENGINE_SECRET = originalEngine;
		if (originalCron === undefined) delete process.env.CRON_JOB_SECRET;
		else process.env.CRON_JOB_SECRET = originalCron;
	});

	it("rules: rejects requests without the engine secret", async () => {
		expect((await getRules(request("GET", "/api/internal/realtime/rules"))).status).toBe(403);
		expect((await getRules(request("GET", "/api/internal/realtime/rules", { secret: "wrong" }))).status).toBe(403);
	});

	it("rules: does not accept the cron secret", async () => {
		const res = await getRules(request("GET", "/api/internal/realtime/rules", { cron: "cron-s3cret" }));
		expect(res.status).toBe(403);
	});

	it("rules: stays closed when OPENLIT_ENGINE_SECRET is unset", async () => {
		delete process.env.OPENLIT_ENGINE_SECRET;
		expect((await getRules(request("GET", "/api/internal/realtime/rules", { secret: "true" }))).status).toBe(403);
		expect((await getRules(request("GET", "/api/internal/realtime/rules", { secret: "" }))).status).toBe(403);
	});

	it("rules: returns the active rule set", async () => {
		const res = await getRules(request("GET", "/api/internal/realtime/rules", { secret: "s3cret" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ rules: [{ id: "builtin.error_rate" }] });
	});

	it("findings: rejects requests without the engine secret", async () => {
		const res = await postFinding(request("POST", "/api/internal/realtime/findings", { body: "{}" }));
		expect(res.status).toBe(403);
		expect(recordRealtimeFinding).not.toHaveBeenCalled();
	});

	it("findings: returns 400 for malformed JSON", async () => {
		const res = await postFinding(request("POST", "/api/internal/realtime/findings", { body: "{not json", secret: "s3cret" }));
		expect(res.status).toBe(400);
	});

	it("findings: records a valid finding", async () => {
		const res = await postFinding(request("POST", "/api/internal/realtime/findings", { body: "{}", secret: "s3cret" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ transition: "opened", id: "f1" });
	});

	it("findings: maps domain errors to their status", async () => {
		(recordRealtimeFinding as jest.Mock).mockRejectedValueOnce(new RealtimeFindingError("conflict", 409));
		const res = await postFinding(request("POST", "/api/internal/realtime/findings", { body: "{}", secret: "s3cret" }));
		expect(res.status).toBe(409);
	});
});
