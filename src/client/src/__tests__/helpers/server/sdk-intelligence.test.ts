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
});
