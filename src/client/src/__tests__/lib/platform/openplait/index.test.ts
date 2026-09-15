/**
 * Unit tests for the OpenPlait ClickHouse wrapper (`lib/platform/openplait/index.ts`).
 *
 * `@openplait/adapter-clickhouse` and `@openplait/runtime` are real ESM
 * packages resolved through jest's moduleNameMapper. We mock them here with
 * lightweight jest classes so tests fully control connection/execute
 * behavior without touching a real ClickHouse server.
 */

import type { DatabaseConfig } from "@prisma/client";

const mockAdapterClose = jest.fn();
const mockAdapterCtor = jest.fn();
const mockRegistryRegister = jest.fn();
const mockRuntimeExecute = jest.fn();
const mockRuntimeCtor = jest.fn();

jest.mock("@openplait/adapter-clickhouse", () => {
	class MockClickHouseAdapter {
		config: unknown;
		close = mockAdapterClose;
		constructor(config: unknown) {
			this.config = config;
			mockAdapterCtor(config);
		}
	}
	return {
		ClickHouseAdapter: MockClickHouseAdapter,
		OPENLIT_CLICKHOUSE_DATASETS: ["traces", "logs", "metrics"],
		OTEL_CLICKHOUSE_DATASETS: ["otel_traces", "otel_logs", "otel_metrics"],
	};
});

jest.mock("@openplait/runtime", () => {
	class MockDatasourceRegistry {
		register(config: unknown) {
			mockRegistryRegister(config);
			return this;
		}
	}
	class MockOpenPlaitRuntime {
		options: unknown;
		execute = mockRuntimeExecute;
		constructor(registry: unknown, options: unknown) {
			this.options = options;
			mockRuntimeCtor(registry, options);
		}
	}
	return {
		DatasourceRegistry: MockDatasourceRegistry,
		OpenPlaitRuntime: MockOpenPlaitRuntime,
	};
});

jest.mock("@/utils/parser", () => ({
	constructURL: jest.fn((host: string, port: string) => `http://${host}:${port}`),
	parseQueryStringToObject: jest.fn((query: string) =>
		query ? { raw: query } : {}
	),
}));

const mockNormalize = jest.fn((query: string) => query);
jest.mock("../../../../lib/platform/openplait/native", () => ({
	normalizeOpenPlaitReadStatement: (query: string) => mockNormalize(query),
}));

const mockFramesToRows = jest.fn();
jest.mock("../../../../lib/platform/openplait/frames", () => ({
	openPlaitFramesToRows: (frames: unknown) => mockFramesToRows(frames),
}));

import {
	validateOpenPlaitClickHouseConnection,
	executeOpenPlaitRead,
	closeOpenPlaitRuntimes,
	type OpenPlaitClickHouseConnection,
} from "@/lib/platform/openplait/index";

function buildDbConfig(overrides: Partial<DatabaseConfig> = {}): DatabaseConfig {
	return {
		id: "db-1",
		host: "clickhouse.local",
		port: "8123",
		database: "openlit",
		username: "default",
		password: "secret",
		query: "",
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	} as DatabaseConfig;
}

const CONNECTION: OpenPlaitClickHouseConnection = {
	host: "clickhouse.local",
	port: "8123",
	database: "openlit",
	username: "default",
	password: "secret",
	query: "",
};

const ORIGINAL_ENV = process.env;

beforeEach(async () => {
	// Drain any runtimes cached by the previous test BEFORE resetting the
	// mocks, so the drain's own `adapter.close()` calls don't pollute this
	// test's call-count assertions.
	await closeOpenPlaitRuntimes();
	jest.clearAllMocks();
	mockNormalize.mockImplementation((query: string) => query);
	mockFramesToRows.mockReturnValue([]);
	process.env = { ...ORIGINAL_ENV };
	delete process.env.OPENPLAIT_CLICKHOUSE_QUERY_TIMEOUT_MS;
	delete process.env.OPENPLAIT_CLICKHOUSE_MAX_RESULT_ROWS;
	delete process.env.OPENPLAIT_CLICKHOUSE_MAX_ROWS_TO_READ;
});

afterAll(() => {
	process.env = ORIGINAL_ENV;
});

describe("validateOpenPlaitClickHouseConnection", () => {
	it("constructs an adapter/registry/runtime, runs a SELECT 1 native query, and closes the adapter", async () => {
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });

		await validateOpenPlaitClickHouseConnection(CONNECTION);

		expect(mockAdapterCtor).toHaveBeenCalledTimes(1);
		expect(mockRegistryRegister).toHaveBeenCalledTimes(1);
		expect(mockRuntimeCtor).toHaveBeenCalledTimes(1);
		expect(mockRuntimeExecute).toHaveBeenCalledTimes(1);
		const executeArg = mockRuntimeExecute.mock.calls[0][0];
		expect(executeArg.queries[0].spec.native.statement).toBe(
			"SELECT 1 AS openplait_connection_ok"
		);
		expect(executeArg.queries[0].spec.mode).toBe("native");
		expect(mockAdapterClose).toHaveBeenCalledTimes(1);
	});

	it("throws a wrapped error including the plain error message and still closes the adapter", async () => {
		mockRuntimeExecute.mockRejectedValue(new Error("connection refused"));

		await expect(
			validateOpenPlaitClickHouseConnection(CONNECTION)
		).rejects.toThrow(
			"OpenPlait ClickHouse validation failed: connection refused"
		);
		expect(mockAdapterClose).toHaveBeenCalledTimes(1);
	});

	it("walks a nested .cause chain to report the deepest error message", async () => {
		const root = new Error("root cause: socket died");
		const middle = new Error("middle wrapper", { cause: root });
		const top = new Error("top wrapper", { cause: middle });
		mockRuntimeExecute.mockRejectedValue(top);

		await expect(
			validateOpenPlaitClickHouseConnection(CONNECTION)
		).rejects.toThrow(
			"OpenPlait ClickHouse validation failed: root cause: socket died"
		);
		expect(mockAdapterClose).toHaveBeenCalledTimes(1);
	});

	it("stops walking the cause chain after 5 levels and reports the deepest reached message", async () => {
		// Build a chain of 7 nested errors; only the first 5 (levels 0-4) are
		// visited by `deepestErrorMessage`'s loop bound.
		let current = new Error("level-0");
		for (let i = 1; i < 7; i += 1) {
			current = new Error(`level-${i}`, { cause: current });
		}
		mockRuntimeExecute.mockRejectedValue(current);

		await expect(
			validateOpenPlaitClickHouseConnection(CONNECTION)
		).rejects.toThrow("OpenPlait ClickHouse validation failed: level-2");
	});

	it("keeps the outer message when a nested cause has an empty message", async () => {
		const inner = new Error("");
		const outer = new Error("outer failure", { cause: inner });
		mockRuntimeExecute.mockRejectedValue(outer);

		await expect(
			validateOpenPlaitClickHouseConnection(CONNECTION)
		).rejects.toThrow(
			"OpenPlait ClickHouse validation failed: outer failure"
		);
	});

	it("falls back to String(error) for a non-Error rejection", async () => {
		mockRuntimeExecute.mockRejectedValue("plain string failure");

		await expect(
			validateOpenPlaitClickHouseConnection(CONNECTION)
		).rejects.toThrow(
			"OpenPlait ClickHouse validation failed: plain string failure"
		);
		expect(mockAdapterClose).toHaveBeenCalledTimes(1);
	});
});

describe("executeOpenPlaitRead", () => {
	it("normalizes the raw query before executing", async () => {
		mockNormalize.mockReturnValue("SELECT 1");
		mockRuntimeExecute.mockResolvedValue({ result: { frames: ["frame"] } });
		mockFramesToRows.mockReturnValue([{ a: 1 }]);

		const rows = await executeOpenPlaitRead({
			query: "  SELECT 1;  ",
			dbConfig: buildDbConfig(),
		});

		expect(mockNormalize).toHaveBeenCalledWith("  SELECT 1;  ");
		const executeArg = mockRuntimeExecute.mock.calls[0][0];
		expect(executeArg.queries[0].spec.native.statement).toBe("SELECT 1");
		expect(mockFramesToRows).toHaveBeenCalledWith(["frame"]);
		expect(rows).toEqual([{ a: 1 }]);
	});

	it("caches the runtime per dbConfig.id across calls with an unchanged fingerprint", async () => {
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		const dbConfig = buildDbConfig();

		await executeOpenPlaitRead({ query: "SELECT 1", dbConfig });
		await executeOpenPlaitRead({ query: "SELECT 2", dbConfig });

		expect(mockAdapterCtor).toHaveBeenCalledTimes(1);
		expect(mockRuntimeCtor).toHaveBeenCalledTimes(1);
		expect(mockRuntimeExecute).toHaveBeenCalledTimes(2);
		expect(mockAdapterClose).not.toHaveBeenCalled();
	});

	it.each([
		["host", { host: "new-host" }],
		["port", { port: "9999" }],
		["database", { database: "new-db" }],
		["username", { username: "new-user" }],
		["query", { query: "?a=b" }],
		["updatedAt", { updatedAt: new Date("2026-06-01T00:00:00.000Z") }],
	])(
		"invalidates the cached runtime when %s changes",
		async (_label, overrides) => {
			mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
			const dbConfig = buildDbConfig();

			await executeOpenPlaitRead({ query: "SELECT 1", dbConfig });
			expect(mockAdapterCtor).toHaveBeenCalledTimes(1);

			const changed = buildDbConfig(overrides);
			await executeOpenPlaitRead({ query: "SELECT 1", dbConfig: changed });

			expect(mockAdapterCtor).toHaveBeenCalledTimes(2);
			expect(mockAdapterClose).toHaveBeenCalledTimes(1);
		}
	);

	it("still computes a stable fingerprint when updatedAt isn't a Date instance", async () => {
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		const dbConfig = buildDbConfig({
			updatedAt: "2026-01-01T00:00:00.000Z" as unknown as Date,
		});

		await executeOpenPlaitRead({ query: "SELECT 1", dbConfig });
		await executeOpenPlaitRead({ query: "SELECT 2", dbConfig });

		expect(mockAdapterCtor).toHaveBeenCalledTimes(1);
		expect(mockAdapterClose).not.toHaveBeenCalled();
	});

	it("still computes a stable fingerprint when updatedAt is missing/falsy", async () => {
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		const dbConfig = buildDbConfig({ updatedAt: null as unknown as Date });

		await executeOpenPlaitRead({ query: "SELECT 1", dbConfig });
		await executeOpenPlaitRead({ query: "SELECT 2", dbConfig });

		expect(mockAdapterCtor).toHaveBeenCalledTimes(1);
		expect(mockAdapterClose).not.toHaveBeenCalled();
	});

	it("does not rebuild the runtime when password changes alone (not part of the fingerprint)", async () => {
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		const dbConfig = buildDbConfig();
		await executeOpenPlaitRead({ query: "SELECT 1", dbConfig });

		const rotatedSecret = buildDbConfig({ password: "different-secret" });
		await executeOpenPlaitRead({ query: "SELECT 1", dbConfig: rotatedSecret });

		expect(mockAdapterCtor).toHaveBeenCalledTimes(1);
		expect(mockAdapterClose).not.toHaveBeenCalled();
	});

	it.each([
		["ECONNRESET", new Error("read ECONNRESET")],
		["ECONNREFUSED", new Error("connect ECONNREFUSED 127.0.0.1:8123")],
		["ETIMEDOUT", new Error("connect ETIMEDOUT")],
		["EPIPE", new Error("write EPIPE")],
		["UND_ERR_SOCKET", Object.assign(new Error("fetch failed"), { code: "UND_ERR_SOCKET" })],
		["socket hang up", new Error("socket hang up")],
		["connection closed", new Error("connection closed unexpectedly")],
		["connection reset", new Error("connection reset by peer")],
	])(
		"retries exactly once and returns the successful result on a transient error (%s)",
		async (_label, transientError) => {
			mockRuntimeExecute
				.mockRejectedValueOnce(transientError)
				.mockResolvedValueOnce({ result: { frames: ["ok-frame"] } });
			mockFramesToRows.mockReturnValue([{ ok: true }]);
			const dbConfig = buildDbConfig();

			const rows = await executeOpenPlaitRead({ query: "SELECT 1", dbConfig });

			expect(rows).toEqual([{ ok: true }]);
			expect(mockRuntimeExecute).toHaveBeenCalledTimes(2);
			// Evicted + recreated once: the original adapter is closed and a
			// second adapter/runtime pair is constructed.
			expect(mockAdapterClose).toHaveBeenCalledTimes(1);
			expect(mockAdapterCtor).toHaveBeenCalledTimes(2);
			expect(mockRuntimeCtor).toHaveBeenCalledTimes(2);
		}
	);

	it("treats a raw (non-Error) transient-looking rejection as transient and retries", async () => {
		mockRuntimeExecute
			.mockRejectedValueOnce("ECONNRESET")
			.mockResolvedValueOnce({ result: { frames: [] } });
		const dbConfig = buildDbConfig();

		await executeOpenPlaitRead({ query: "SELECT 1", dbConfig });

		expect(mockRuntimeExecute).toHaveBeenCalledTimes(2);
		expect(mockAdapterClose).toHaveBeenCalledTimes(1);
	});

	it("treats an error with an empty-string .code as non-transient when the message doesn't match either", async () => {
		const errorWithEmptyCode = Object.assign(new Error("boom"), { code: "" });
		mockRuntimeExecute.mockRejectedValueOnce(errorWithEmptyCode);
		const dbConfig = buildDbConfig();

		await expect(
			executeOpenPlaitRead({ query: "SELECT 1", dbConfig })
		).rejects.toThrow("boom");
		expect(mockRuntimeExecute).toHaveBeenCalledTimes(1);
	});

	it("propagates a raw (non-Error), non-transient rejection immediately", async () => {
		mockRuntimeExecute.mockRejectedValueOnce("just a plain string failure");
		const dbConfig = buildDbConfig();

		await expect(
			executeOpenPlaitRead({ query: "SELECT 1", dbConfig })
		).rejects.toBe("just a plain string failure");
		expect(mockRuntimeExecute).toHaveBeenCalledTimes(1);
	});

	it("builds a datasource config with an empty password when dbConfig.password is falsy", async () => {
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		const dbConfig = buildDbConfig({ password: null });

		await executeOpenPlaitRead({ query: "SELECT 1", dbConfig });

		expect(mockAdapterCtor).toHaveBeenCalledTimes(1);
		expect(mockAdapterCtor.mock.calls[0][0].password).toBe("");
	});

	it("detects a transient error nested in a .cause chain", async () => {
		const nested = new Error("wrapper", {
			cause: new Error("ECONNRESET while streaming"),
		});
		mockRuntimeExecute
			.mockRejectedValueOnce(nested)
			.mockResolvedValueOnce({ result: { frames: [] } });
		const dbConfig = buildDbConfig();

		await executeOpenPlaitRead({ query: "SELECT 1", dbConfig });

		expect(mockRuntimeExecute).toHaveBeenCalledTimes(2);
		expect(mockAdapterClose).toHaveBeenCalledTimes(1);
	});

	it("propagates a non-transient error immediately without retrying", async () => {
		mockRuntimeExecute.mockRejectedValueOnce(new Error("syntax error"));
		const dbConfig = buildDbConfig();

		await expect(
			executeOpenPlaitRead({ query: "SELECT 1", dbConfig })
		).rejects.toThrow("syntax error");

		expect(mockRuntimeExecute).toHaveBeenCalledTimes(1);
		expect(mockAdapterClose).not.toHaveBeenCalled();
	});

	it("propagates a second transient failure (retry itself fails) without a further retry", async () => {
		mockRuntimeExecute
			.mockRejectedValueOnce(new Error("ECONNRESET"))
			.mockRejectedValueOnce(new Error("ECONNRESET again"));
		const dbConfig = buildDbConfig();

		await expect(
			executeOpenPlaitRead({ query: "SELECT 1", dbConfig })
		).rejects.toThrow("ECONNRESET again");

		expect(mockRuntimeExecute).toHaveBeenCalledTimes(2);
	});
});

describe("evictRuntime race guard", () => {
	it("skips deleting/closing when the cache entry was already replaced by a concurrent caller", async () => {
		// Two concurrent `executeOpenPlaitRead` calls for the same dbConfig
		// both grab the same initial cached entry, then both hit a transient
		// error. The second eviction to run must be a no-op: the entry it
		// expected to delete has already been replaced by the first
		// eviction/rebuild, so it should neither delete the newer entry nor
		// close the newer adapter a second time.
		const dbConfig = buildDbConfig();

		let resolveFirstExecuteA: (v: unknown) => void;
		let resolveFirstExecuteB: (v: unknown) => void;
		const firstExecuteA = new Promise((resolve) => {
			resolveFirstExecuteA = resolve;
		});
		const firstExecuteB = new Promise((resolve) => {
			resolveFirstExecuteB = resolve;
		});

		let callCount = 0;
		mockRuntimeExecute.mockImplementation(() => {
			callCount += 1;
			if (callCount === 1) return firstExecuteA.then(() => { throw new Error("ECONNRESET"); });
			if (callCount === 2) return firstExecuteB.then(() => { throw new Error("ECONNRESET"); });
			return Promise.resolve({ result: { frames: [] } });
		});

		const callA = executeOpenPlaitRead({ query: "SELECT 1", dbConfig });
		const callB = executeOpenPlaitRead({ query: "SELECT 2", dbConfig });

		// Both calls have now grabbed the same cached `first` entry (only one
		// adapter/runtime constructed so far) and are awaiting their first
		// `execute()` call.
		await Promise.resolve();
		await Promise.resolve();
		expect(mockAdapterCtor).toHaveBeenCalledTimes(1);

		// Let A's first execute reject, triggering A's evict + rebuild.
		resolveFirstExecuteA!(undefined);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		// Let B's first execute reject too. B's `first` reference is the
		// *original* (now-stale) entry, so its `evictRuntime` call should
		// see the cache already pointing at A's newer entry and no-op.
		resolveFirstExecuteB!(undefined);

		const [resultA, resultB] = await Promise.all([callA, callB]);
		expect(resultA).toEqual([]);
		expect(resultB).toEqual([]);

		// Exactly one adapter close: from A's successful eviction. B's
		// eviction attempt found a mismatched cache entry and skipped both
		// the delete and the close.
		expect(mockAdapterClose).toHaveBeenCalledTimes(1);
		expect(mockAdapterCtor).toHaveBeenCalledTimes(2);
	});
});

describe("closeOpenPlaitRuntimes", () => {
	it("closes every cached adapter and clears the cache so the next call rebuilds", async () => {
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		await executeOpenPlaitRead({ query: "SELECT 1", dbConfig: buildDbConfig({ id: "db-a" }) });
		await executeOpenPlaitRead({ query: "SELECT 1", dbConfig: buildDbConfig({ id: "db-b" }) });
		expect(mockAdapterCtor).toHaveBeenCalledTimes(2);

		await closeOpenPlaitRuntimes();

		expect(mockAdapterClose).toHaveBeenCalledTimes(2);

		await executeOpenPlaitRead({ query: "SELECT 1", dbConfig: buildDbConfig({ id: "db-a" }) });
		expect(mockAdapterCtor).toHaveBeenCalledTimes(3);
	});

	it("is a no-op when there are no cached runtimes", async () => {
		await expect(closeOpenPlaitRuntimes()).resolves.toBeUndefined();
		expect(mockAdapterClose).not.toHaveBeenCalled();
	});
});

describe("connectionConfig env var parsing (positiveInteger)", () => {
	it("uses defaults when env vars are unset", async () => {
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		await validateOpenPlaitClickHouseConnection(CONNECTION);

		const adapterConfig = mockAdapterCtor.mock.calls[0][0];
		expect(adapterConfig.queryTimeoutMs).toBe(60_000);
		expect(adapterConfig.maxResultRows).toBe(100_000);
		expect(adapterConfig.maxRowsToRead).toBe(10_000_000);
	});

	it.each([
		["not-a-number", undefined],
		["0", undefined],
		["-5", undefined],
		["3.5", undefined],
	])(
		"falls back to the default for invalid queryTimeoutMs value %s",
		async (value) => {
			process.env.OPENPLAIT_CLICKHOUSE_QUERY_TIMEOUT_MS = value;
			mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
			await validateOpenPlaitClickHouseConnection(CONNECTION);

			const adapterConfig = mockAdapterCtor.mock.calls[0][0];
			expect(adapterConfig.queryTimeoutMs).toBe(60_000);
		}
	);

	it("accepts a valid positive integer queryTimeoutMs", async () => {
		process.env.OPENPLAIT_CLICKHOUSE_QUERY_TIMEOUT_MS = "5000";
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		await validateOpenPlaitClickHouseConnection(CONNECTION);

		const adapterConfig = mockAdapterCtor.mock.calls[0][0];
		expect(adapterConfig.queryTimeoutMs).toBe(5000);
		const runtimeOptions = mockRuntimeCtor.mock.calls[0][1];
		expect(runtimeOptions.defaultTimeoutMs).toBe(5000);
	});

	it("accepts a valid positive integer maxResultRows and maxRowsToRead", async () => {
		process.env.OPENPLAIT_CLICKHOUSE_MAX_RESULT_ROWS = "42";
		process.env.OPENPLAIT_CLICKHOUSE_MAX_ROWS_TO_READ = "4200";
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		await validateOpenPlaitClickHouseConnection(CONNECTION);

		const adapterConfig = mockAdapterCtor.mock.calls[0][0];
		expect(adapterConfig.maxResultRows).toBe(42);
		expect(adapterConfig.maxRowsToRead).toBe(4200);
	});

	it("falls back to defaults for invalid maxResultRows/maxRowsToRead", async () => {
		process.env.OPENPLAIT_CLICKHOUSE_MAX_RESULT_ROWS = "not-a-number";
		process.env.OPENPLAIT_CLICKHOUSE_MAX_ROWS_TO_READ = "-1";
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		await validateOpenPlaitClickHouseConnection(CONNECTION);

		const adapterConfig = mockAdapterCtor.mock.calls[0][0];
		expect(adapterConfig.maxResultRows).toBe(100_000);
		expect(adapterConfig.maxRowsToRead).toBe(10_000_000);
	});

	it("passes through the OpenLIT ClickHouse datasets and application metadata", async () => {
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		await validateOpenPlaitClickHouseConnection(CONNECTION);

		const adapterConfig = mockAdapterCtor.mock.calls[0][0];
		expect(adapterConfig.datasets).toEqual([
			"otel_traces",
			"otel_logs",
			"otel_metrics",
			"traces",
			"logs",
			"metrics",
		]);
		expect(adapterConfig.applicationName).toBe("openlit-openplait");
		expect(adapterConfig.allowNativeQueries).toBe(true);
		expect(adapterConfig.requireTimeRange).toBe(false);
		expect(adapterConfig.url).toBe("http://clickhouse.local:8123");
	});

	it("passes httpHeaders parsed from the connection query string", async () => {
		mockRuntimeExecute.mockResolvedValue({ result: { frames: [] } });
		await validateOpenPlaitClickHouseConnection({
			...CONNECTION,
			query: "foo=bar",
			password: null,
		});

		const adapterConfig = mockAdapterCtor.mock.calls[0][0];
		expect(adapterConfig.httpHeaders).toEqual({ raw: "foo=bar" });
		expect(adapterConfig.password).toBe("");
	});
});
