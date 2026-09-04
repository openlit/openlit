jest.mock("@/lib/telemetry-source", () => ({
	resolveSignalSource: jest.fn(),
}));
jest.mock("@/lib/db-config", () => ({
	getDBConfigByUser: jest.fn(),
}));

import { resolveSignalSource } from "@/lib/telemetry-source";
import { getDBConfigByUser } from "@/lib/db-config";
import { resolveRuleEngineDatabaseConfigId } from "@/lib/platform/rule-engine/source";

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

describe("resolveRuleEngineDatabaseConfigId", () => {
	beforeEach(() => jest.clearAllMocks());

	it("uses the selected environment's intelligence ClickHouse binding", async () => {
		(resolveSignalSource as jest.Mock).mockResolvedValue({
			hasSource: true,
			descriptor: { type: "clickhouse", dbConfigId: "db-production" },
		});

		await expect(
			resolveRuleEngineDatabaseConfigId(requestWithContext({ environment: "production" }))
		).resolves.toBe("db-production");
		expect(resolveSignalSource).toHaveBeenCalledWith("intelligence", {
			environment: "production",
		});
	});

	it("uses environment binding even when an explicit ClickHouse header is present", async () => {
		(resolveSignalSource as jest.Mock).mockResolvedValue({
			hasSource: true,
			descriptor: { type: "clickhouse", dbConfigId: "db-production" },
		});

		await expect(
			resolveRuleEngineDatabaseConfigId(
				requestWithContext({
					environment: "production",
					databaseConfigId: "db-selected",
				})
			)
		).resolves.toBe("db-production");
		expect(resolveSignalSource).toHaveBeenCalledWith("intelligence", {
			environment: "production",
		});
		expect(getDBConfigByUser).not.toHaveBeenCalled();
	});

	it("uses the explicitly selected project ClickHouse when no environment is set", async () => {
		(getDBConfigByUser as jest.Mock).mockResolvedValue([
			{ id: "db-selected" },
			{ id: "db-other" },
		]);

		await expect(
			resolveRuleEngineDatabaseConfigId(
				requestWithContext({
					databaseConfigId: "db-selected",
				})
			)
		).resolves.toBe("db-selected");
		expect(resolveSignalSource).not.toHaveBeenCalled();
	});

	it("rejects an explicit ClickHouse outside the current project", async () => {
		(getDBConfigByUser as jest.Mock).mockResolvedValue([{ id: "db-allowed" }]);

		await expect(
			resolveRuleEngineDatabaseConfigId(
				requestWithContext({ databaseConfigId: "db-forged" })
			)
		).rejects.toThrow("not available in the current project");
	});

	it("fails closed when the selected environment has no ClickHouse", async () => {
		(resolveSignalSource as jest.Mock).mockResolvedValue({
			hasSource: false,
			descriptor: { type: "clickhouse", dbConfigId: undefined },
		});

		await expect(
			resolveRuleEngineDatabaseConfigId(requestWithContext({ environment: "staging" }))
		).rejects.toThrow("requires a ClickHouse datasource");
	});
});
