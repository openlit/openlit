const mockUpdateCrontab = jest.fn();

jest.mock("@/helpers/server/cron", () =>
	jest.fn().mockImplementation(() => ({
		updateCrontab: mockUpdateCrontab,
	}))
);

import { restoreAgentsMaterializeCron } from "@/lib/platform/agents/config";

describe("restoreAgentsMaterializeCron", () => {
	const originalSchedule = process.env.AGENTS_MATERIALIZE_SCHEDULE;
	let cwdSpy: jest.SpyInstance<string, []>;

	beforeEach(() => {
		jest.clearAllMocks();
		cwdSpy = jest.spyOn(process, "cwd").mockReturnValue("/app");
	});

	afterEach(() => {
		cwdSpy.mockRestore();
		if (originalSchedule === undefined) {
			delete process.env.AGENTS_MATERIALIZE_SCHEDULE;
		} else {
			process.env.AGENTS_MATERIALIZE_SCHEDULE = originalSchedule;
		}
	});

	it("installs the agents materializer cron with defaults", async () => {
		const logSpy = jest.spyOn(console, "log").mockImplementation();

		await restoreAgentsMaterializeCron("https://api.openlit.local");

		expect(mockUpdateCrontab).toHaveBeenCalledWith({
			cronId: "openlit-agents-materialize",
			cronSchedule: "* * * * *",
			cronEnvVars: {
				API_URL: "https://api.openlit.local",
				CRON_ID: "openlit-agents-materialize",
			},
			cronScriptPath: "/app/scripts/agents/materialize.js",
			cronLogPath: "/app/logs/agents/materialize.log",
		});
		expect(logSpy).toHaveBeenCalledWith("Installed agents materialize cron");
		logSpy.mockRestore();
	});

	it("uses custom schedule and logs install failures", async () => {
		process.env.AGENTS_MATERIALIZE_SCHEDULE = "*/5 * * * *";
		mockUpdateCrontab.mockImplementationOnce(() => {
			throw new Error("cron unavailable");
		});
		const errorSpy = jest.spyOn(console, "error").mockImplementation();

		await restoreAgentsMaterializeCron("https://api.openlit.local");

		expect(mockUpdateCrontab).toHaveBeenCalledWith(
			expect.objectContaining({ cronSchedule: "*/5 * * * *" })
		);
		expect(errorSpy).toHaveBeenCalledWith(
			"Failed to install agents materialize cron:",
			expect.any(Error)
		);
		errorSpy.mockRestore();
	});
});
