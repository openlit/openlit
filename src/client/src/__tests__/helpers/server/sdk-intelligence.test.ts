jest.mock("@/lib/platform/api-keys", () => ({
	getAPIKeyInfo: jest.fn(),
}));
jest.mock("@/lib/db-config", () => ({
	getDBConfigByIdInternal: jest.fn(),
}));
jest.mock("@/lib/telemetry-source", () => ({
	resolveSignalSource: jest.fn(),
}));
jest.mock("@/constants/messages", () => ({
	__esModule: true,
	default: jest.fn(() => ({
		NO_API_KEY: "No API key",
	})),
}));

import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getDBConfigByIdInternal } from "@/lib/db-config";
import { resolveSignalSource } from "@/lib/telemetry-source";
import { resolveSdkIntelligenceDatabaseConfig } from "@/helpers/server/sdk-intelligence";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";

function makeRequest(headers: Record<string, string> = {}) {
	return {
		headers: {
			get: (name: string) =>
				headers[name.toLowerCase()] ?? headers[name] ?? null,
		},
	} as unknown as Request;
}

describe("resolveSdkIntelligenceDatabaseConfig", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([
			null,
			{ id: "key-1", databaseConfigId: "db-key", createdByUserId: "u1" },
		]);
	});

	it("prefers intelligence signal routing when environment is present", async () => {
		(getDBConfigByIdInternal as jest.Mock).mockResolvedValue({
			id: "db-key",
			projectId: "proj-1",
		});
		(resolveSignalSource as jest.Mock).mockResolvedValue({
			hasSource: true,
			descriptor: {
				type: "clickhouse",
				dbConfigId: "db-intelligence",
			},
		});

		await expect(
			resolveSdkIntelligenceDatabaseConfig(
				makeRequest({
					[OPENLIT_CONTEXT_HEADERS.environment]: "staging",
					[OPENLIT_CONTEXT_HEADERS.projectId]: "proj-1",
				}),
				"openlit-test"
			)
		).resolves.toEqual([
			null,
			expect.objectContaining({
				databaseConfigId: "db-intelligence",
				via: "signalRouting",
			}),
		]);
	});

	it("supports explicit database-config header when in the API key project", async () => {
		(getDBConfigByIdInternal as jest.Mock)
			.mockResolvedValueOnce({ id: "db-key", projectId: "proj-1" })
			.mockResolvedValueOnce({ id: "db-other", projectId: "proj-1" });

		await expect(
			resolveSdkIntelligenceDatabaseConfig(
				makeRequest({
					[OPENLIT_CONTEXT_HEADERS.databaseConfigId]: "db-other",
				}),
				"openlit-test"
			)
		).resolves.toEqual([
			null,
			expect.objectContaining({
				databaseConfigId: "db-other",
				via: "databaseConfigHeader",
			}),
		]);
		expect(resolveSignalSource).not.toHaveBeenCalled();
	});

	it("short-circuits when the explicit database-config header matches the key's own binding", async () => {
		await expect(
			resolveSdkIntelligenceDatabaseConfig(
				makeRequest({
					[OPENLIT_CONTEXT_HEADERS.databaseConfigId]: "db-key",
				}),
				"openlit-test"
			)
		).resolves.toEqual([
			null,
			expect.objectContaining({
				databaseConfigId: "db-key",
				via: "databaseConfigHeader",
			}),
		]);
		expect(getDBConfigByIdInternal).not.toHaveBeenCalled();
	});

	it("falls back to the API key bound database config for existing SDKs", async () => {
		await expect(
			resolveSdkIntelligenceDatabaseConfig(makeRequest(), "openlit-test")
		).resolves.toEqual([
			null,
			expect.objectContaining({
				databaseConfigId: "db-key",
				via: "apiKey",
			}),
		]);
	});

	it("prefers the middleware-injected database-config header over the key binding for the apiKey path", async () => {
		await expect(
			resolveSdkIntelligenceDatabaseConfig(
				makeRequest({ "x-database-config-id": "db-middleware" }),
				"openlit-test"
			)
		).resolves.toEqual([
			null,
			expect.objectContaining({
				databaseConfigId: "db-middleware",
				via: "apiKey",
			}),
		]);
	});

	it("returns NO_API_KEY when the trimmed apiKey is empty", async () => {
		await expect(
			resolveSdkIntelligenceDatabaseConfig(makeRequest(), "   ")
		).resolves.toEqual(["No API key", null]);
		expect(getAPIKeyInfo).not.toHaveBeenCalled();
	});

	it("returns NO_API_KEY when getAPIKeyInfo errors", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue(["boom", null]);

		await expect(
			resolveSdkIntelligenceDatabaseConfig(makeRequest(), "openlit-test")
		).resolves.toEqual(["No API key", null]);
	});

	it("returns NO_API_KEY when the API key has no bound database config", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([
			null,
			{ id: "key-1", createdByUserId: "u1" },
		]);

		await expect(
			resolveSdkIntelligenceDatabaseConfig(makeRequest(), "openlit-test")
		).resolves.toEqual(["No API key", null]);
	});

	it("infers the project id from the key's database config when the project header is absent", async () => {
		(getDBConfigByIdInternal as jest.Mock).mockResolvedValue({
			id: "db-key",
			projectId: "proj-inferred",
		});
		(resolveSignalSource as jest.Mock).mockResolvedValue({
			hasSource: true,
			descriptor: {
				type: "clickhouse",
				dbConfigId: "db-intelligence",
			},
		});

		await expect(
			resolveSdkIntelligenceDatabaseConfig(
				makeRequest({ [OPENLIT_CONTEXT_HEADERS.environment]: "staging" }),
				"openlit-test"
			)
		).resolves.toEqual([
			null,
			expect.objectContaining({
				databaseConfigId: "db-intelligence",
				via: "signalRouting",
			}),
		]);
		expect(getDBConfigByIdInternal).toHaveBeenCalledWith({ id: "db-key" });
		expect(resolveSignalSource).toHaveBeenCalledWith(
			"intelligence",
			expect.objectContaining({ projectId: "proj-inferred" })
		);
	});

	it("returns an error when the environment has no resolvable project id", async () => {
		(getDBConfigByIdInternal as jest.Mock).mockResolvedValue(null);

		await expect(
			resolveSdkIntelligenceDatabaseConfig(
				makeRequest({ [OPENLIT_CONTEXT_HEADERS.environment]: "staging" }),
				"openlit-test"
			)
		).resolves.toEqual([
			null,
			expect.objectContaining({
				databaseConfigId: "db-key",
				via: "apiKey",
			}),
		]);
	});

	it("returns an error when intelligence ClickHouse is not configured for the project environment", async () => {
		(getDBConfigByIdInternal as jest.Mock).mockResolvedValue({
			id: "db-key",
			projectId: "proj-1",
		});
		(resolveSignalSource as jest.Mock).mockResolvedValue({
			hasSource: false,
			descriptor: { type: "clickhouse", dbConfigId: "db-intelligence" },
		});

		await expect(
			resolveSdkIntelligenceDatabaseConfig(
				makeRequest({
					[OPENLIT_CONTEXT_HEADERS.environment]: "staging",
					[OPENLIT_CONTEXT_HEADERS.projectId]: "proj-1",
				}),
				"openlit-test"
			)
		).resolves.toEqual([
			"Intelligence ClickHouse is not configured for the selected project environment.",
			null,
		]);
	});

	it("returns an error when the resolved signal source descriptor is not clickhouse", async () => {
		(getDBConfigByIdInternal as jest.Mock).mockResolvedValue({
			id: "db-key",
			projectId: "proj-1",
		});
		(resolveSignalSource as jest.Mock).mockResolvedValue({
			hasSource: true,
			descriptor: { type: "tempo", dbConfigId: undefined },
		});

		await expect(
			resolveSdkIntelligenceDatabaseConfig(
				makeRequest({
					[OPENLIT_CONTEXT_HEADERS.environment]: "staging",
					[OPENLIT_CONTEXT_HEADERS.projectId]: "proj-1",
				}),
				"openlit-test"
			)
		).resolves.toEqual([
			"Intelligence ClickHouse is not configured for the selected project environment.",
			null,
		]);
	});

	it("rejects an explicit database-config header when the requested project does not match the key's project", async () => {
		(getDBConfigByIdInternal as jest.Mock)
			.mockResolvedValueOnce({ id: "db-key", projectId: "proj-1" })
			.mockResolvedValueOnce({ id: "db-other", projectId: "proj-2" });

		await expect(
			resolveSdkIntelligenceDatabaseConfig(
				makeRequest({
					[OPENLIT_CONTEXT_HEADERS.databaseConfigId]: "db-other",
				}),
				"openlit-test"
			)
		).resolves.toEqual([
			"The selected database configuration is not available for this API key.",
			null,
		]);
	});

	it("rejects an explicit database-config header when either database config lookup is missing a project id", async () => {
		(getDBConfigByIdInternal as jest.Mock)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "db-other", projectId: "proj-1" });

		await expect(
			resolveSdkIntelligenceDatabaseConfig(
				makeRequest({
					[OPENLIT_CONTEXT_HEADERS.databaseConfigId]: "db-other",
				}),
				"openlit-test"
			)
		).resolves.toEqual([
			"The selected database configuration is not available for this API key.",
			null,
		]);
	});
});
