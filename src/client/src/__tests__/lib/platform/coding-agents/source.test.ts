jest.mock("@/lib/telemetry-source", () => ({
	resolveSignalSource: jest.fn(),
}));
jest.mock("@/lib/db-config", () => ({
	getDBConfigByUser: jest.fn(),
}));
jest.mock("@/lib/platform/coding-agents/auth", () => ({
	requireCodingAgentAuth: jest.fn(),
}));

import { resolveSignalSource } from "@/lib/telemetry-source";
import { getDBConfigByUser } from "@/lib/db-config";
import { requireCodingAgentAuth } from "@/lib/platform/coding-agents/auth";
import {
	isCodingAgentClickHouseSql,
	resolveCodingAgentsClickHouseDbConfigId,
	resolveCodingAgentsDatabaseConfigId,
	requireCodingAgentQueryContext,
} from "@/lib/platform/coding-agents/source";

function requestWithContext({
	environment,
	databaseConfigId,
}: {
	environment?: string;
	databaseConfigId?: string;
} = {}): Request {
	return {
		headers: {
			get: jest.fn((name: string) => {
				if (name === "x-openlit-environment") return environment || null;
				if (name === "x-openlit-database-config-id") {
					return databaseConfigId || null;
				}
				return null;
			}),
		},
	} as unknown as Request;
}

describe("isCodingAgentClickHouseSql", () => {
	it("detects coding-agent seed SQL", () => {
		expect(
			isCodingAgentClickHouseSql(
				"SELECT countIf(SpanName = 'coding_agent.tool.call') AS total_tools FROM otel_traces"
			)
		).toBe(true);
		expect(
			isCodingAgentClickHouseSql(
				"SELECT count() FROM otel_traces WHERE SpanAttributes['gen_ai.system'] = 'openai'"
			)
		).toBe(false);
	});
});

describe("resolveCodingAgentsClickHouseDbConfigId", () => {
	beforeEach(() => jest.clearAllMocks());

	it("returns intelligence ClickHouse when traces is Tempo", async () => {
		(resolveSignalSource as jest.Mock)
			.mockResolvedValueOnce({
				hasSource: true,
				descriptor: { type: "tempo" },
			})
			.mockResolvedValueOnce({
				hasSource: true,
				descriptor: { type: "clickhouse", dbConfigId: "db-intel" },
			});

		await expect(
			resolveCodingAgentsClickHouseDbConfigId({ environment: "production" })
		).resolves.toBe("db-intel");
	});

	it("forwards project and dbConfig scope so sessionless callers skip getCurrentUser", async () => {
		(resolveSignalSource as jest.Mock)
			.mockResolvedValueOnce({
				hasSource: true,
				descriptor: { type: "tempo" },
			})
			.mockResolvedValueOnce({
				hasSource: true,
				descriptor: { type: "clickhouse", dbConfigId: "db-intel" },
			});

		await expect(
			resolveCodingAgentsClickHouseDbConfigId({
				environment: "production",
				projectId: "proj-1",
				dbConfigId: "db-intel",
			})
		).resolves.toBe("db-intel");
		expect(resolveSignalSource).toHaveBeenCalledWith("traces", {
			environment: "production",
			projectId: "proj-1",
			dbConfigId: "db-intel",
		});
		expect(resolveSignalSource).toHaveBeenNthCalledWith(2, "intelligence", {
			environment: "production",
			projectId: "proj-1",
			dbConfigId: "db-intel",
		});
	});

	it("returns null when no ClickHouse binding exists", async () => {
		(resolveSignalSource as jest.Mock)
			.mockResolvedValueOnce({ hasSource: true, descriptor: { type: "tempo" } })
			.mockResolvedValueOnce({ hasSource: false, descriptor: { type: "clickhouse" } });

		await expect(
			resolveCodingAgentsClickHouseDbConfigId({ environment: "production" })
		).resolves.toBeNull();
	});
});

describe("resolveCodingAgentsDatabaseConfigId", () => {
	beforeEach(() => jest.clearAllMocks());

	it("uses the selected environment's traces ClickHouse binding", async () => {
		(resolveSignalSource as jest.Mock).mockResolvedValueOnce({
			hasSource: true,
			descriptor: { type: "clickhouse", dbConfigId: "db-traces" },
		});

		await expect(
			resolveCodingAgentsDatabaseConfigId(
				requestWithContext({ environment: "production" })
			)
		).resolves.toBe("db-traces");
		expect(resolveSignalSource).toHaveBeenCalledWith("traces", {
			environment: "production",
		});
	});

	it("falls back to intelligence ClickHouse when traces is external", async () => {
		(resolveSignalSource as jest.Mock)
			.mockResolvedValueOnce({
				hasSource: true,
				descriptor: { type: "tempo", dbConfigId: undefined },
			})
			.mockResolvedValueOnce({
				hasSource: true,
				descriptor: { type: "clickhouse", dbConfigId: "db-intel" },
			});

		await expect(
			resolveCodingAgentsDatabaseConfigId(
				requestWithContext({ environment: "production" })
			)
		).resolves.toBe("db-intel");
		expect(resolveSignalSource).toHaveBeenNthCalledWith(2, "intelligence", {
			environment: "production",
		});
	});

	it("prefers signal-routed ClickHouse over the ambient database header", async () => {
		(resolveSignalSource as jest.Mock).mockResolvedValueOnce({
			hasSource: true,
			descriptor: { type: "clickhouse", dbConfigId: "db-traces" },
		});
		(getDBConfigByUser as jest.Mock).mockResolvedValue([
			{ id: "db-selected" },
			{ id: "db-traces" },
		]);

		await expect(
			resolveCodingAgentsDatabaseConfigId(
				requestWithContext({
					environment: "production",
					databaseConfigId: "db-selected",
				})
			)
		).resolves.toBe("db-traces");
		expect(getDBConfigByUser).not.toHaveBeenCalled();
	});

	it("falls back to the project database header when signal routing has no ClickHouse", async () => {
		(resolveSignalSource as jest.Mock)
			.mockResolvedValueOnce({
				hasSource: true,
				descriptor: { type: "tempo" },
			})
			.mockResolvedValueOnce({
				hasSource: false,
				descriptor: { type: "clickhouse" },
			});
		(getDBConfigByUser as jest.Mock).mockResolvedValue([{ id: "db-selected" }]);

		await expect(
			resolveCodingAgentsDatabaseConfigId(
				requestWithContext({
					environment: "production",
					databaseConfigId: "db-selected",
				})
			)
		).resolves.toBe("db-selected");
	});

	it("fails closed when neither traces nor intelligence is ClickHouse and no header", async () => {
		(resolveSignalSource as jest.Mock)
			.mockResolvedValueOnce({
				hasSource: true,
				descriptor: { type: "tempo" },
			})
			.mockResolvedValueOnce({
				hasSource: false,
				descriptor: { type: "clickhouse" },
			});

		await expect(
			resolveCodingAgentsDatabaseConfigId(
				requestWithContext({ environment: "staging" })
			)
		).rejects.toThrow(/ClickHouse/);
	});
});

describe("requireCodingAgentQueryContext", () => {
	it("attaches the routed dbConfigId to auth", async () => {
		(requireCodingAgentAuth as jest.Mock).mockResolvedValue({
			userId: "u1",
			organizationId: "o1",
			role: "admin",
			rawRole: "owner",
		});
		(resolveSignalSource as jest.Mock).mockResolvedValue({
			hasSource: true,
			descriptor: { type: "clickhouse", dbConfigId: "db-1" },
		});

		await expect(
			requireCodingAgentQueryContext(
				requestWithContext({ environment: "production" })
			)
		).resolves.toEqual({
			userId: "u1",
			organizationId: "o1",
			role: "admin",
			rawRole: "owner",
			dbConfigId: "db-1",
		});
	});
});
