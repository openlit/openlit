jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(async () => ({ id: "u1" })) }));
jest.mock("@/lib/prisma", () => ({ __esModule: true, default: {} }));
jest.mock("@/lib/access/route-access", () => ({
	withRouteAccess: jest.fn((access, handler) => Object.assign(handler, { __access: access })),
}));
jest.mock("@/lib/audit/route", () => ({
	withAudit: jest.fn((handler) => Object.assign(handler, { __audited: true })),
}));
jest.mock("@/lib/platform/realtime/rule-store", () => {
	const actual = jest.requireActual("@/lib/platform/realtime/rule-store");
	return {
		RealtimeRuleError: actual.RealtimeRuleError,
		parseRealtimeRuleInput: actual.parseRealtimeRuleInput,
		resolveRealtimeRuleScope: jest.fn(),
	};
});
jest.mock("@/lib/platform/alerts/threshold", () => ({
	listThresholdAlerts: jest.fn(async () => [{ id: "a1" }]),
	createThresholdAlert: jest.fn(async () => ({ id: "a1" })),
	getThresholdAlert: jest.fn(async () => ({ id: "a1" })),
	updateThresholdAlert: jest.fn(async () => ({ id: "a1" })),
	setThresholdAlertEnabled: jest.fn(async () => ({ id: "a1", enabled: false })),
	deleteThresholdAlert: jest.fn(async () => ({ id: "a1" })),
	listThresholdAlertFindings: jest.fn(async () => []),
	listThresholdAlertSignals: jest.fn(async () => ({ available: true, signals: [] })),
	getThresholdAlertOverview: jest.fn(async () => ({ alerts: 0 })),
}));

import { resolveRealtimeRuleScope } from "@/lib/platform/realtime/rule-store";
import {
	createThresholdAlert,
	deleteThresholdAlert,
	setThresholdAlertEnabled,
	updateThresholdAlert,
} from "@/lib/platform/alerts/threshold";
import { GET as LIST, POST as CREATE } from "@/lib/rbac/routes/api/alerts/route";
import { DELETE, GET as GET_ONE, PATCH } from "@/lib/rbac/routes/api/alerts/[id]/route";
import { GET as OVERVIEW } from "@/lib/rbac/routes/api/alerts/overview/route";
import { GET as TEMPLATES } from "@/lib/rbac/routes/api/alerts/templates/route";
import { GET as FINDINGS } from "@/lib/rbac/routes/api/alerts/[id]/findings/route";
import { GET as SIGNALS } from "@/lib/rbac/routes/api/alerts/[id]/signals/route";

const scope = { organisationId: "org1", projectId: "proj1", environment: "staging", userId: "u1" };
const ctx = { params: { id: "a1" } };
const validBody = {
	name: "gpt-4o cost",
	definition: { metric: "cost", operator: "gt", threshold: 5, windowSec: 300 },
};

function request(options: { json?: () => Promise<unknown>; env?: string; url?: string } = {}) {
	return {
		url: options.url ?? "http://localhost/api/alerts",
		headers: { get: (name: string) => (name === "x-openlit-environment" ? options.env ?? null : null) },
		json: options.json ?? (async () => validBody),
	} as unknown as Request;
}

const accessOf = (handler: any) => handler.__access;
const auditedOf = (handler: any) => !!handler.__audited;

beforeEach(() => {
	jest.clearAllMocks();
	(resolveRealtimeRuleScope as jest.Mock).mockResolvedValue(scope);
});

describe("threshold alert routes", () => {
	it("maps every route to a neutral alerts access key and audits changes", () => {
		expect([LIST, GET_ONE, OVERVIEW, TEMPLATES, FINDINGS, SIGNALS].map(accessOf)).toEqual(Array(6).fill("alerts.read"));
		expect([CREATE, PATCH, DELETE].map(accessOf)).toEqual(["alerts.create", "alerts.update", "alerts.delete"]);
		expect([CREATE, PATCH, DELETE].map(auditedOf)).toEqual([true, true, true]);
		expect([LIST, GET_ONE].map(auditedOf)).toEqual([false, false]);
	});

	it("takes the tenant from the session and the request environment", async () => {
		const res = await LIST(request({ env: "staging" }));
		expect(res.status).toBe(200);
		expect(resolveRealtimeRuleScope).toHaveBeenCalledWith("staging");
	});

	it("creates an alert in the session scope in one step", async () => {
		const res = await CREATE(request());
		expect(res.status).toBe(201);
		expect((createThresholdAlert as jest.Mock).mock.calls[0][0]).toBe(scope);
		expect((createThresholdAlert as jest.Mock).mock.calls[0][1]).toMatchObject({
			name: "gpt-4o cost",
			kind: "cost",
			definition: { metric: "cost", threshold: 5, windowSec: 300 },
		});
	});

	it("ignores tenant fields in the body", async () => {
		await CREATE(request({ json: async () => ({ ...validBody, organisationId: "org2", projectId: "victim", scope: { projectId: "victim" } }) }));
		const input = (createThresholdAlert as jest.Mock).mock.calls[0][1];
		expect(JSON.stringify(input)).not.toContain("victim");
	});

	it("rejects malformed JSON and invalid alerts with 400", async () => {
		expect((await CREATE(request({ json: async () => { throw new SyntaxError("bad"); } }))).status).toBe(400);
		expect((await CREATE(request({ json: async () => ({ name: "x", definition: { metric: "nope" } }) }))).status).toBe(400);
		expect(createThresholdAlert).not.toHaveBeenCalled();
	});

	it("toggles with { enabled } and replaces the definition otherwise", async () => {
		await PATCH(request({ json: async () => ({ enabled: false }) }), ctx);
		expect(setThresholdAlertEnabled).toHaveBeenCalledWith(scope, "a1", false);
		expect(updateThresholdAlert).not.toHaveBeenCalled();
		expect((await PATCH(request({ json: async () => ({ enabled: "no" }) }), ctx)).status).toBe(400);
		await PATCH(request(), ctx);
		expect((updateThresholdAlert as jest.Mock).mock.calls[0].slice(0, 2)).toEqual([scope, "a1"]);
	});

	it("deletes by id within the session scope", async () => {
		expect((await DELETE(request(), ctx)).status).toBe(200);
		expect(deleteThresholdAlert).toHaveBeenCalledWith(scope, "a1");
	});

	it("maps scope errors to their status", async () => {
		const { RealtimeRuleError } = jest.requireActual("@/lib/platform/realtime/rule-store");
		(resolveRealtimeRuleScope as jest.Mock).mockRejectedValue(new RealtimeRuleError("no env", 404));
		expect((await LIST(request({ env: "nope" }))).status).toBe(404);
	});
});
