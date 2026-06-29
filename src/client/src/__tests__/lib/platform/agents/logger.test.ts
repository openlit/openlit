import { agentsLogger } from "@/lib/platform/agents/logger";

describe("agentsLogger", () => {
	const originalLevel = process.env.AGENTS_LOG_LEVEL;
	const originalStack = process.env.AGENTS_LOG_STACK;

	beforeEach(() => {
		jest.clearAllMocks();
		delete process.env.AGENTS_LOG_LEVEL;
		delete process.env.AGENTS_LOG_STACK;
		jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		jest.useRealTimers();
		if (originalLevel === undefined) {
			delete process.env.AGENTS_LOG_LEVEL;
		} else {
			process.env.AGENTS_LOG_LEVEL = originalLevel;
		}
		if (originalStack === undefined) {
			delete process.env.AGENTS_LOG_STACK;
		} else {
			process.env.AGENTS_LOG_STACK = originalStack;
		}
	});

	it("emits structured error, warn, and info logs", () => {
		const errorSpy = jest.spyOn(console, "error").mockImplementation();
		const warnSpy = jest.spyOn(console, "warn").mockImplementation();
		const logSpy = jest.spyOn(console, "log").mockImplementation();

		const error = new Error("bad");
		agentsLogger.error("failed", { err: error });
		agentsLogger.warn("degraded", { count: 2 });
		agentsLogger.info("ready", { service: "api" });

		expect(JSON.parse(errorSpy.mock.calls[0][0] as string)).toMatchObject({
			level: "error",
			ts: "2026-01-01T00:00:00.000Z",
			scope: "agents",
			event: "failed",
			err: {
				message: "bad",
				name: "Error",
			},
		});
		expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toMatchObject({
			level: "warn",
			event: "degraded",
			count: 2,
		});
		expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toMatchObject({
			level: "info",
			event: "ready",
			service: "api",
		});

		errorSpy.mockRestore();
		warnSpy.mockRestore();
		logSpy.mockRestore();
	});

	it("honors log levels and debug opt-in", () => {
		const logSpy = jest.spyOn(console, "log").mockImplementation();

		agentsLogger.debug("hidden");
		expect(logSpy).not.toHaveBeenCalled();

		process.env.AGENTS_LOG_LEVEL = "debug";
		agentsLogger.debug("visible");
		expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toMatchObject({
			level: "debug",
			event: "visible",
		});

		process.env.AGENTS_LOG_LEVEL = "not-real";
		agentsLogger.debug("hidden-again");
		expect(logSpy).toHaveBeenCalledTimes(1);

		logSpy.mockRestore();
	});

	it("omits error stacks when disabled", () => {
		process.env.AGENTS_LOG_STACK = "false";
		const errorSpy = jest.spyOn(console, "error").mockImplementation();

		agentsLogger.error("failed", { error: new Error("bad") });

		const payload = JSON.parse(errorSpy.mock.calls[0][0] as string);
		expect(payload.error).toEqual({
			message: "bad",
			name: "Error",
		});
		expect(payload.error.stack).toBeUndefined();

		errorSpy.mockRestore();
	});

	it("falls back to unstructured output for circular fields", () => {
		const logSpy = jest.spyOn(console, "log").mockImplementation();
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		agentsLogger.info("circular", circular);

		expect(logSpy).toHaveBeenCalledWith("[agents:info] circular");
		logSpy.mockRestore();
	});
});
