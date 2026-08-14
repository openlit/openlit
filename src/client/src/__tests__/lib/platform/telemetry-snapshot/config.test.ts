const mockUpdateCrontab = jest.fn();
const mockDeleteCronJob = jest.fn();

jest.mock("@/helpers/server/cron", () =>
	jest.fn().mockImplementation(() => ({
		updateCrontab: mockUpdateCrontab,
		deleteCronJob: mockDeleteCronJob,
	}))
);

import { restoreTelemetrySnapshotCron } from "@/lib/platform/telemetry-snapshot/config";

describe("restoreTelemetrySnapshotCron", () => {
	const originalEnabled = process.env.TELEMETRY_ENABLED;
	const originalSchedule = process.env.TELEMETRY_SNAPSHOT_SCHEDULE;
	let cwdSpy: jest.SpyInstance<string, []>;

	beforeEach(() => {
		jest.clearAllMocks();
		cwdSpy = jest.spyOn(process, "cwd").mockReturnValue("/app");
		delete process.env.TELEMETRY_ENABLED;
		delete process.env.TELEMETRY_SNAPSHOT_SCHEDULE;
	});

	afterEach(() => {
		cwdSpy.mockRestore();
		if (originalEnabled === undefined) {
			delete process.env.TELEMETRY_ENABLED;
		} else {
			process.env.TELEMETRY_ENABLED = originalEnabled;
		}
		if (originalSchedule === undefined) {
			delete process.env.TELEMETRY_SNAPSHOT_SCHEDULE;
		} else {
			process.env.TELEMETRY_SNAPSHOT_SCHEDULE = originalSchedule;
		}
	});

	it("deletes the cron and skips install when telemetry is disabled", async () => {
		process.env.TELEMETRY_ENABLED = "false";
		const logSpy = jest.spyOn(console, "log").mockImplementation();

		await restoreTelemetrySnapshotCron("https://api.example");

		expect(mockDeleteCronJob).toHaveBeenCalledWith("openlit-telemetry-snapshot");
		expect(mockUpdateCrontab).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Telemetry disabled")
		);
		logSpy.mockRestore();
	});

	it("swallows delete errors when telemetry is disabled", async () => {
		process.env.TELEMETRY_ENABLED = "false";
		mockDeleteCronJob.mockImplementation(() => {
			throw new Error("missing");
		});
		jest.spyOn(console, "log").mockImplementation();

		await expect(
			restoreTelemetrySnapshotCron("https://api.example")
		).resolves.toBeUndefined();
	});

	it("installs the cron with default schedule", async () => {
		const logSpy = jest.spyOn(console, "log").mockImplementation();

		await restoreTelemetrySnapshotCron("https://api.openlit.local");

		expect(mockUpdateCrontab).toHaveBeenCalledWith({
			cronId: "openlit-telemetry-snapshot",
			cronSchedule: "17 3 * * *",
			cronEnvVars: {
				API_URL: "https://api.openlit.local",
				CRON_ID: "openlit-telemetry-snapshot",
			},
			cronScriptPath: "/app/scripts/telemetry-snapshot/snapshot.js",
			cronLogPath: "/app/logs/telemetry-snapshot/snapshot.log",
		});
		expect(logSpy).toHaveBeenCalledWith("Installed telemetry snapshot cron");
		logSpy.mockRestore();
	});

	it("honors TELEMETRY_SNAPSHOT_SCHEDULE override", async () => {
		process.env.TELEMETRY_SNAPSHOT_SCHEDULE = "0 12 * * *";
		jest.spyOn(console, "log").mockImplementation();

		await restoreTelemetrySnapshotCron("https://api.example");

		expect(mockUpdateCrontab).toHaveBeenCalledWith(
			expect.objectContaining({ cronSchedule: "0 12 * * *" })
		);
	});

	it("logs and swallows install failures", async () => {
		mockUpdateCrontab.mockImplementation(() => {
			throw new Error("crontab write failed");
		});
		const errSpy = jest.spyOn(console, "error").mockImplementation();

		await expect(
			restoreTelemetrySnapshotCron("https://api.example")
		).resolves.toBeUndefined();
		expect(errSpy).toHaveBeenCalledWith(
			"Failed to install telemetry snapshot cron:",
			expect.any(Error)
		);
		errSpy.mockRestore();
	});
});
