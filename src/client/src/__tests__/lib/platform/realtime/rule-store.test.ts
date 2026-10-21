jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: jest.fn(),
	getCurrentProjectForOrganisation: jest.fn(),
}));
jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		projectEnvironment: { findUnique: jest.fn() },
		realtimeRule: {
			findMany: jest.fn(),
			findFirst: jest.fn(),
			count: jest.fn(),
			create: jest.fn(),
			update: jest.fn(),
			delete: jest.fn(),
		},
	},
}));

import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getCurrentOrganisation, getCurrentProjectForOrganisation } from "@/lib/organisation";
import {
	RealtimeRuleError,
	createRealtimeRule,
	deleteRealtimeRule,
	listEngineRealtimeRules,
	parseEngineRuleId,
	parseRealtimeRuleInput,
	resetRealtimeRuleCache,
	resolveRealtimeRuleScope,
	updateRealtimeRule,
} from "@/lib/platform/realtime/rule-store";

const scope = { organisationId: "org1", projectId: "proj1", environment: "production", userId: "u1" };

function body(overrides: Record<string, unknown> = {}, definition: Record<string, unknown> = {}) {
	return {
		name: "Error spike",
		mode: "window",
		severity: "critical",
		definition: {
			metric: "error_rate",
			operator: "gt",
			threshold: 0.2,
			windowSec: 300,
			minSamples: 10,
			groupBy: ["service"],
			match: [{ field: "model", op: "eq", values: ["gpt-4o"] }],
			...definition,
		},
		...overrides,
	};
}

function row(overrides: Record<string, unknown> = {}) {
	return {
		id: "r1",
		organisationId: "org1",
		projectId: "proj1",
		environment: "production",
		name: "Error spike",
		owner: "alert",
		description: "",
		kind: "threshold",
		mode: "window",
		severity: "critical",
		enabled: true,
		definition: JSON.stringify(parseRealtimeRuleInput(body()).definition),
		createdByUserId: "u1",
		updatedByUserId: "u1",
		createdAt: new Date("2026-10-01T00:00:00Z"),
		updatedAt: new Date("2026-10-01T00:00:00Z"),
		...overrides,
	};
}

beforeEach(() => {
	jest.clearAllMocks();
});

describe("parseRealtimeRuleInput", () => {
	it("treats a value list on = and != as one-of, and rejects lists on single-value operators", () => {
		const match = (op: string, values: string[]) =>
			parseRealtimeRuleInput(body({}, { match: [{ field: "model", op, values }] })).definition.match;
		expect(match("eq", ["gpt-4o", "gpt-4o-mini"])).toEqual([{ field: "model", op: "in", values: ["gpt-4o", "gpt-4o-mini"] }]);
		expect(match("neq", ["a", "b"])).toEqual([{ field: "model", op: "not_in", values: ["a", "b"] }]);
		expect(match("eq", ["gpt-4o"])).toEqual([{ field: "model", op: "eq", values: ["gpt-4o"] }]);
		expect(() => match("contains", ["a", "b"])).toThrow();
		expect(() =>
			parseRealtimeRuleInput(body({}, { match: [{ field: "duration_ms", op: "gt", values: ["1", "2"] }] }))
		).toThrow();
	});

	it("accepts a valid window rule and ignores any scope in the body", () => {
		const input = parseRealtimeRuleInput(
			body({ scope: { organisationId: "other", projectId: "other" }, organisationId: "other" })
		);
		expect(input).not.toHaveProperty("scope");
		expect(input).not.toHaveProperty("organisationId");
		expect(input.definition.metric).toBe("error_rate");
	});

	it.each([
		["unknown metric", body({}, { metric: "rm -rf" })],
		["window too long", body({}, { windowSec: 7200 })],
		["window too short", body({}, { windowSec: 5 })],
		["negative threshold", body({}, { threshold: -1 })],
		["prompt attribute", body({}, { match: [{ field: "gen_ai.prompt", op: "exists" }] })],
		["unknown op", body({}, { match: [{ field: "model", op: "regex", values: [".*"] }] })],
		["too many groupBy", body({}, { groupBy: ["service", "model", "provider", "operation"] })],
		["non-numeric numeric op", body({}, { match: [{ field: "duration_ms", op: "gt", values: ["x"] }] })],
		["empty name", body({ name: "  " })],
		["oversized name", body({ name: "x".repeat(121) })],
		["instant without match", body({ mode: "instant" }, { match: [] })],
		["oversized value", body({}, { match: [{ field: "model", op: "eq", values: ["x".repeat(257)] }] })],
	])("rejects %s", (_label, input) => {
		expect(() => parseRealtimeRuleInput(input)).toThrow(RealtimeRuleError);
	});
});

describe("resolveRealtimeRuleScope", () => {
	beforeEach(() => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getCurrentOrganisation as jest.Mock).mockResolvedValue({ id: "org1" });
		(getCurrentProjectForOrganisation as jest.Mock).mockResolvedValue({ id: "proj1" });
		(prisma.projectEnvironment.findUnique as jest.Mock).mockResolvedValue({ id: "env1" });
	});

	it("derives the tenant from the session and normalises the environment", async () => {
		await expect(resolveRealtimeRuleScope("Staging")).resolves.toEqual({
			organisationId: "org1",
			projectId: "proj1",
			environment: "staging",
			userId: "u1",
		});
		expect(prisma.projectEnvironment.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { projectId_name: { projectId: "proj1", name: "staging" } } })
		);
	});

	it("rejects environments that do not exist in the current project", async () => {
		(prisma.projectEnvironment.findUnique as jest.Mock).mockResolvedValue(null);
		await expect(resolveRealtimeRuleScope("prod")).rejects.toMatchObject({ status: 404 });
	});

	it("requires project access", async () => {
		(getCurrentProjectForOrganisation as jest.Mock).mockResolvedValue(null);
		await expect(resolveRealtimeRuleScope(undefined)).rejects.toMatchObject({ status: 403 });
	});

	it("requires a session", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		await expect(resolveRealtimeRuleScope(undefined)).rejects.toMatchObject({ status: 401 });
	});
});

describe("rule CRUD scoping", () => {
	it("creates rules in the session scope and enforces the project cap", async () => {
		(prisma.realtimeRule.count as jest.Mock).mockResolvedValueOnce(0);
		(prisma.realtimeRule.create as jest.Mock).mockResolvedValueOnce(row());
		await createRealtimeRule(scope, "alert", parseRealtimeRuleInput(body()));
		expect((prisma.realtimeRule.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
			organisationId: "org1",
			projectId: "proj1",
			environment: "production",
			owner: "alert",
			createdByUserId: "u1",
		});

		(prisma.realtimeRule.count as jest.Mock).mockResolvedValueOnce(50);
		await expect(createRealtimeRule(scope, "alert", parseRealtimeRuleInput(body()))).rejects.toMatchObject({
			status: 409,
		});
	});

	it("never updates or deletes a rule from another project or environment", async () => {
		(prisma.realtimeRule.findFirst as jest.Mock).mockResolvedValue(null);
		await expect(updateRealtimeRule(scope, "alert", "r-other", parseRealtimeRuleInput(body()))).rejects.toMatchObject({
			status: 404,
		});
		await expect(deleteRealtimeRule(scope, "alert", "r-other")).rejects.toMatchObject({ status: 404 });
		expect((prisma.realtimeRule.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({
			id: "r-other",
			owner: "alert",
			organisationId: "org1",
			projectId: "proj1",
			environment: "production",
		});
		expect(prisma.realtimeRule.update).not.toHaveBeenCalled();
		expect(prisma.realtimeRule.delete).not.toHaveBeenCalled();
	});

	it("rejects malformed rule ids before querying", async () => {
		await expect(deleteRealtimeRule(scope, "alert", "../../x")).rejects.toMatchObject({ status: 404 });
		expect(prisma.realtimeRule.findFirst).not.toHaveBeenCalled();
	});
});

describe("listEngineRealtimeRules", () => {
	beforeEach(() => resetRealtimeRuleCache());

	it("scopes every engine rule to its stored tenant and skips unparseable definitions", async () => {
		(prisma.realtimeRule.findMany as jest.Mock).mockResolvedValue([
			row(),
			row({ id: "r3", definition: "not json" }),
		]);
		const rules = await listEngineRealtimeRules();
		expect(rules).toHaveLength(1);
		expect(rules[0]).toMatchObject({
			id: "alert.r1",
			scope: { organisationId: "org1", projectId: "proj1", environment: "production" },
		});
		expect((prisma.realtimeRule.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ enabled: true });
	});

	it("caches the active set briefly", async () => {
		(prisma.realtimeRule.findMany as jest.Mock).mockResolvedValue([row()]);
		await listEngineRealtimeRules();
		await listEngineRealtimeRules();
		expect(prisma.realtimeRule.findMany).toHaveBeenCalledTimes(1);
	});
});

describe("parseEngineRuleId", () => {
	it("accepts owner-prefixed ids and rejects anything else", () => {
		expect(parseEngineRuleId("alert.cmv1")).toEqual({ owner: "alert", id: "cmv1" });
		expect(parseEngineRuleId("builtin.error_rate")).toBeNull();
		expect(parseEngineRuleId("alert.../x")).toBeNull();
		expect(parseEngineRuleId("alert")).toBeNull();
	});
});
