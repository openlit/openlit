jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		project: { findUnique: jest.fn() },
		projectEnvironment: { findUnique: jest.fn() },
		realtimeFinding: {
			findUnique: jest.fn(),
			create: jest.fn(),
			update: jest.fn(),
			findMany: jest.fn(),
		},
	},
}));
jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: jest.fn(),
	getCurrentProjectForOrganisation: jest.fn(),
}));
jest.mock("@/lib/platform/realtime/extension", () => ({
	getExtensionRealtimeRules: jest.fn(async () => []),
	onRealtimeFinding: jest.fn(async () => undefined),
}));

import prisma from "@/lib/prisma";
import { getCurrentOrganisation, getCurrentProjectForOrganisation } from "@/lib/organisation";
import { getExtensionRealtimeRules, onRealtimeFinding } from "@/lib/platform/realtime/extension";
import {
	RealtimeFindingError,
	listRealtimeFindings,
	parseRealtimeFindingInput,
	recordRealtimeFinding,
} from "@/lib/platform/realtime/findings";

const now = new Date("2026-10-02T10:00:00.000Z");

function payload(overrides: Record<string, unknown> = {}) {
	return {
		ruleId: "builtin.error_rate",
		ruleName: "ignored from payload",
		kind: "security",
		severity: "info",
		state: "firing",
		organisationId: "org1",
		projectId: "proj1",
		environment: "production",
		group: { service: "svc" },
		metric: "error_rate",
		operator: "gt",
		value: 0.9,
		threshold: 0.25,
		windowSec: 300,
		sampleCount: 40,
		dedupeKey: "0123456789abcdef0123456789abcdef",
		observedAt: now.toISOString(),
		sample: { traceId: "t", spanId: "s" },
		...overrides,
	};
}

function row(overrides: Record<string, unknown> = {}) {
	return {
		id: "f1",
		organisationId: "org1",
		projectId: "proj1",
		environment: "production",
		ruleId: "builtin.error_rate",
		ruleName: "Error rate spike",
		kind: "threshold",
		mode: "window",
		severity: "warning",
		state: "firing",
		dedupeKey: "0123456789abcdef0123456789abcdef",
		metric: "error_rate",
		operator: "gt",
		value: 0.9,
		threshold: 0.25,
		windowSec: 300,
		sampleCount: 40,
		group: '{"service":"svc"}',
		sample: "{}",
		occurrences: 1,
		firstSeenAt: now,
		lastSeenAt: now,
		resolvedAt: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

describe("parseRealtimeFindingInput", () => {
	it("accepts a valid payload", () => {
		const input = parseRealtimeFindingInput(payload({ group: { service: "svc", "user.id": "user-1" } }));
		expect(input.projectId).toBe("proj1");
		expect(input.group["user.id"]).toBe("user-1");
		expect(input.observedAt.toISOString()).toBe(now.toISOString());
	});

	it.each([
		["non-object", "x"],
		["bad state", payload({ state: "open" })],
		["bad org id", payload({ organisationId: "org.1" })],
		["bad environment", payload({ environment: "Prod Env" })],
		["non-finite value", payload({ value: "NaN" })],
		["bad dedupe key", payload({ dedupeKey: "zz" })],
		["bad date", payload({ observedAt: "yesterday" })],
		["nested group", payload({ group: { service: { x: 1 } } })],
		["prompt group key", payload({ group: { "gen_ai.prompt": "secret" } })],
	])("rejects %s", (_label, body) => {
		expect(() => parseRealtimeFindingInput(body)).toThrow(RealtimeFindingError);
	});
});

describe("recordRealtimeFinding", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getExtensionRealtimeRules as jest.Mock).mockResolvedValue([]);
		(prisma.project.findUnique as jest.Mock).mockResolvedValue({ organisationId: "org1" });
		(prisma.projectEnvironment.findUnique as jest.Mock).mockResolvedValue({ id: "env1" });
		(prisma.realtimeFinding.findUnique as jest.Mock).mockResolvedValue(null);
		(prisma.realtimeFinding.create as jest.Mock).mockImplementation(async ({ data }) => row(data));
		(prisma.realtimeFinding.update as jest.Mock).mockImplementation(async ({ data }) => row(data));
	});

	it("opens a finding with server-side rule metadata and notifies the extension", async () => {
		const result = await recordRealtimeFinding(parseRealtimeFindingInput(payload()));
		expect(result.transition).toBe("opened");
		const data = (prisma.realtimeFinding.create as jest.Mock).mock.calls[0][0].data;
		expect(data.kind).toBe("threshold");
		expect(data.severity).toBe("warning");
		expect(data.ruleName).toBe("Error rate spike");
		expect(onRealtimeFinding).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj1" }), "opened");
	});

	it("rejects unknown rules", async () => {
		await expect(
			recordRealtimeFinding(parseRealtimeFindingInput(payload({ ruleId: "custom.nope" })))
		).rejects.toMatchObject({ status: 404 });
	});

	it("rejects extension rules scoped to another tenant", async () => {
		(getExtensionRealtimeRules as jest.Mock).mockResolvedValue([
			{ id: "custom.1", name: "c", kind: "security", mode: "instant", severity: "critical", scope: { organisationId: "org2" }, threshold: 0, match: [{ field: "status", op: "eq", values: ["error"] }] },
		]);
		await expect(
			recordRealtimeFinding(parseRealtimeFindingInput(payload({ ruleId: "custom.1" })))
		).rejects.toMatchObject({ status: 404 });
	});

	it("rejects a project that belongs to another organisation", async () => {
		(prisma.project.findUnique as jest.Mock).mockResolvedValue({ organisationId: "org2" });
		await expect(recordRealtimeFinding(parseRealtimeFindingInput(payload()))).rejects.toMatchObject({ status: 404 });
		expect(prisma.realtimeFinding.create).not.toHaveBeenCalled();
	});

	it("rejects an unknown environment", async () => {
		(prisma.projectEnvironment.findUnique as jest.Mock).mockResolvedValue(null);
		await expect(recordRealtimeFinding(parseRealtimeFindingInput(payload()))).rejects.toMatchObject({ status: 404 });
	});

	it("refuses to move a dedupe key to another tenant", async () => {
		(prisma.realtimeFinding.findUnique as jest.Mock).mockResolvedValue(row({ projectId: "projX" }));
		await expect(recordRealtimeFinding(parseRealtimeFindingInput(payload()))).rejects.toMatchObject({ status: 409 });
	});

	it("updates an open finding without notifying again", async () => {
		(prisma.realtimeFinding.findUnique as jest.Mock).mockResolvedValue(row());
		const result = await recordRealtimeFinding(parseRealtimeFindingInput(payload()));
		expect(result.transition).toBe("updated");
		expect(onRealtimeFinding).not.toHaveBeenCalled();
	});

	it("reopens a resolved finding", async () => {
		(prisma.realtimeFinding.findUnique as jest.Mock).mockResolvedValue(row({ state: "resolved", resolvedAt: now }));
		const result = await recordRealtimeFinding(parseRealtimeFindingInput(payload()));
		expect(result.transition).toBe("reopened");
		const data = (prisma.realtimeFinding.update as jest.Mock).mock.calls[0][0].data;
		expect(data.occurrences).toEqual({ increment: 1 });
		expect(data.resolvedAt).toBeNull();
	});

	it("resolves an open finding and ignores resolving unknown ones", async () => {
		(prisma.realtimeFinding.findUnique as jest.Mock).mockResolvedValueOnce(row());
		const resolved = await recordRealtimeFinding(
			parseRealtimeFindingInput(payload({ state: "resolved", value: 0, sampleCount: 0 }))
		);
		expect(resolved.transition).toBe("resolved");
		const { data } = (prisma.realtimeFinding.update as jest.Mock).mock.calls.at(-1)[0];
		expect(data).toEqual({ state: "resolved", resolvedAt: expect.any(Date) });
		(prisma.realtimeFinding.findUnique as jest.Mock).mockResolvedValueOnce(null);
		const ignored = await recordRealtimeFinding(parseRealtimeFindingInput(payload({ state: "resolved" })));
		expect(ignored.transition).toBe("ignored");
	});
});

describe("listRealtimeFindings", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentOrganisation as jest.Mock).mockResolvedValue({ id: "org1" });
		(getCurrentProjectForOrganisation as jest.Mock).mockResolvedValue({ id: "proj1" });
		(prisma.realtimeFinding.findMany as jest.Mock).mockResolvedValue([row()]);
	});

	it("always scopes by the current organisation, project, and requested environment", async () => {
		const findings = await listRealtimeFindings({ environment: "Staging", state: "firing" });
		expect(findings[0].group).toEqual({ service: "svc" });
		expect((prisma.realtimeFinding.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
			organisationId: "org1",
			projectId: "proj1",
			environment: "staging",
			state: "firing",
		});
	});

	it("requires a current project", async () => {
		(getCurrentProjectForOrganisation as jest.Mock).mockResolvedValue(null);
		await expect(listRealtimeFindings({ environment: "production" })).rejects.toMatchObject({ status: 400 });
	});
});
