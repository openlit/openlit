const mockRunClickhouseMigrations = jest.fn();
const mockRestoreEvaluationCronJobs = jest.fn();
const mockRestorePricingCronJobs = jest.fn();
const mockRestoreAgentsMaterializeCron = jest.fn();
const mockRestoreTelemetrySnapshotCron = jest.fn();
const mockSyncAllActiveLicensesIfDue = jest.fn();

jest.mock("@/lib/platform/clickhouse/helpers", () => ({
	runClickhouseMigrations: mockRunClickhouseMigrations,
}));
jest.mock("@/lib/platform/evaluation/config", () => ({
	restoreEvaluationCronJobs: mockRestoreEvaluationCronJobs,
}));
jest.mock("@/lib/platform/pricing/config", () => ({
	restorePricingCronJobs: mockRestorePricingCronJobs,
}));
jest.mock("@/lib/platform/agents/config", () => ({
	restoreAgentsMaterializeCron: mockRestoreAgentsMaterializeCron,
}));
jest.mock("@/lib/platform/telemetry-snapshot/config", () => ({
	restoreTelemetrySnapshotCron: mockRestoreTelemetrySnapshotCron,
}));
jest.mock("@/lib/license-boot-sync", () => ({
	syncAllActiveLicensesIfDue: mockSyncAllActiveLicensesIfDue,
}));

import { register } from "@/instrumentation";

const SUCCESS_LINES = [
	"✅ Evaluation cron jobs restored",
	"✅ Pricing cron jobs restored",
	"✅ Agents materialize cron installed",
	"✅ Telemetry snapshot cron installed",
];

describe("register", () => {
	const originalRuntime = process.env.NEXT_RUNTIME;
	let logSpy: jest.SpyInstance;

	beforeEach(() => {
		jest.clearAllMocks();
		process.env.NEXT_RUNTIME = "nodejs";
		mockRunClickhouseMigrations.mockResolvedValue(undefined);
		mockSyncAllActiveLicensesIfDue.mockResolvedValue({ ran: false });
		logSpy = jest.spyOn(console, "log").mockImplementation();
		jest.spyOn(console, "error").mockImplementation();
	});

	afterEach(() => {
		jest.restoreAllMocks();
		if (originalRuntime === undefined) {
			delete process.env.NEXT_RUNTIME;
		} else {
			process.env.NEXT_RUNTIME = originalRuntime;
		}
	});

	function loggedLines(): string[] {
		return logSpy.mock.calls.map((args) => String(args[0]));
	}

	it("logs each cron step as done when it succeeded", async () => {
		mockRestoreEvaluationCronJobs.mockResolvedValue(true);
		mockRestorePricingCronJobs.mockResolvedValue(true);
		mockRestoreAgentsMaterializeCron.mockResolvedValue(true);
		mockRestoreTelemetrySnapshotCron.mockResolvedValue(true);

		await register();

		expect(loggedLines()).toEqual(expect.arrayContaining(SUCCESS_LINES));
	});

	it("does not log a cron step as done when it reported failure", async () => {
		mockRestoreEvaluationCronJobs.mockResolvedValue(false);
		mockRestorePricingCronJobs.mockResolvedValue(false);
		mockRestoreAgentsMaterializeCron.mockResolvedValue(false);
		mockRestoreTelemetrySnapshotCron.mockResolvedValue(false);

		await register();

		const lines = loggedLines();
		for (const line of SUCCESS_LINES) {
			expect(lines).not.toContain(line);
		}
		expect(lines).toContain("✨ Server initialization complete");
	});
});
