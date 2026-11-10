jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: jest.fn(),
	getCurrentProjectForOrganisation: jest.fn(),
}));
jest.mock("@/lib/platform/realtime/signals", () => ({ listLiveSignals: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		realtimeRule: { findMany: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
		realtimeFinding: { groupBy: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
	},
}));

import prisma from "@/lib/prisma";
import { listLiveSignals } from "@/lib/platform/realtime/signals";
import {
	deleteThresholdAlert,
	listThresholdAlertSignals,
	listThresholdAlerts,
} from "@/lib/platform/alerts/threshold";

const now = new Date("2026-10-14T10:00:00Z");
const scope = { organisationId: "org1", projectId: "proj1", environment: "production", userId: "u1" };

function rule(overrides: Record<string, unknown> = {}) {
	return {
		id: "a1",
		organisationId: "org1",
		projectId: "proj1",
		environment: "production",
		owner: "alert",
		name: "gpt-4o cost",
		description: "",
		kind: "cost",
		mode: "window",
		severity: "critical",
		enabled: true,
		definition: JSON.stringify({ match: [{ field: "model", op: "eq", values: ["gpt-4o"] }], groupBy: ["model"], metric: "cost", operator: "gt", threshold: 5, windowSec: 300, cooldownSec: 900 }),
		createdByUserId: "u1",
		updatedByUserId: "u1",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

beforeEach(() => jest.clearAllMocks());

describe("threshold alerts", () => {
	it("derives status from the alert's own findings", async () => {
		(prisma.realtimeRule.findMany as jest.Mock).mockResolvedValue([rule(), rule({ id: "a2" }), rule({ id: "a3", enabled: false })]);
		(prisma.realtimeFinding.groupBy as jest.Mock).mockResolvedValue([
			{ ruleId: "alert.a1", state: "firing", _count: { _all: 2 }, _sum: { occurrences: 3 }, _max: { lastSeenAt: now } },
			{ ruleId: "alert.a2", state: "resolved", _count: { _all: 1 }, _sum: { occurrences: 1 }, _max: { lastSeenAt: now } },
		]);
		const alerts = await listThresholdAlerts(scope);
		expect(alerts.map((a) => [a.id, a.status, a.firingCount, a.occurrences])).toEqual([
			["a1", "firing", 2, 3],
			["a2", "ok", 0, 1],
			["a3", "disabled", 0, 0],
		]);
		expect((prisma.realtimeRule.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({ owner: "alert", projectId: "proj1" });
		expect((prisma.realtimeFinding.groupBy as jest.Mock).mock.calls[0][0].where).toEqual({ projectId: "proj1", environment: "production" });
	});

	it("deletes the alert's findings with it, inside the session scope", async () => {
		(prisma.realtimeRule.findFirst as jest.Mock).mockResolvedValue(rule());
		await deleteThresholdAlert(scope, "a1");
		expect(prisma.realtimeFinding.deleteMany).toHaveBeenCalledWith({
			where: { projectId: "proj1", environment: "production", ruleId: "alert.a1" },
		});
		expect(prisma.realtimeRule.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
	});

	it("shows only recent spans that match the alert's filters", async () => {
		(prisma.realtimeRule.findFirst as jest.Mock).mockResolvedValue(rule());
		(listLiveSignals as jest.Mock).mockResolvedValue({
			available: true,
			signals: [
				{ model: "gpt-4o", service: "a", attributes: {} },
				{ model: "gpt-4o-mini", service: "b", attributes: {} },
			],
		});
		const result = await listThresholdAlertSignals(scope, "a1");
		expect(result.signals.map((s) => s.service)).toEqual(["a"]);
		expect(listLiveSignals).toHaveBeenCalledWith({ environment: "production", limit: 200 });
	});
});
