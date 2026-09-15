jest.mock("@/lib/platform/common", () => ({
	OTEL_TRACES_TABLE_NAME: "otel_traces",
	OTEL_LOGS_TABLE_NAME: "otel_logs",
	OTEL_METRICS_GAUGE_TABLE_NAME: "otel_metrics_gauge",
	OTEL_METRICS_SUM_TABLE_NAME: "otel_metrics_sum",
	OTEL_METRICS_HISTOGRAM_TABLE_NAME: "otel_metrics_histogram",
	OTEL_METRICS_SUMMARY_TABLE_NAME: "otel_metrics_summary",
	OTEL_METRICS_EXPONENTIAL_HISTOGRAM_TABLE_NAME:
		"otel_metrics_exponential_histogram",
	dataCollector: jest.fn(),
}));
jest.mock("@/lib/db-config", () => ({
	getDBConfigByIdInternal: jest.fn(),
	getDBConfigByUser: jest.fn(),
}));
jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		clickhouseMigrations: {
			findFirst: jest.fn(),
			create: jest.fn(),
		},
		project: {
			findUnique: jest.fn(),
		},
	},
}));
jest.mock("@/utils/asaw", () =>
	jest.fn(async (promise: Promise<unknown>) => {
		try {
			return [null, await promise];
		} catch (err) {
			return [err];
		}
	})
);
jest.mock("@/utils/log", () => ({
	consoleLog: jest.fn(),
}));

import { dataCollector } from "@/lib/platform/common";
import { getDBConfigByIdInternal } from "@/lib/db-config";
import prisma from "@/lib/prisma";
import BackfillOtelTenantEnvironmentMigration from "@/clickhouse/migrations/backfill-otel-tenant-environment-migration";

describe("BackfillOtelTenantEnvironmentMigration", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getDBConfigByIdInternal as jest.Mock).mockResolvedValue({
			id: "db-1",
			projectId: "proj-1",
			environment: "staging",
		});
		(prisma.clickhouseMigrations.findFirst as jest.Mock).mockResolvedValue(null);
		(prisma.clickhouseMigrations.create as jest.Mock).mockResolvedValue({});
		(prisma.project.findUnique as jest.Mock).mockResolvedValue({
			organisationId: "org-1",
		});
		(dataCollector as jest.Mock).mockResolvedValue({ err: null });
	});

	it("stamps empty default environments from the database config scope", async () => {
		const result = await BackfillOtelTenantEnvironmentMigration("db-1");
		expect(result).toEqual({ migrationExist: false, queriesRun: true });
		expect(dataCollector).toHaveBeenCalled();
		const query = String((dataCollector as jest.Mock).mock.calls[0][0].query);
		expect(query).toContain("deployment.environment");
		expect(query).toContain("staging");
		expect(query).toContain("openlit.organisation.id");
		expect(query).toContain("org-1");
		expect(query).toContain("openlit.project.id");
		expect(query).toContain("proj-1");
		expect(prisma.clickhouseMigrations.create).toHaveBeenCalledWith({
			data: {
				databaseConfigId: "db-1",
				clickhouseMigrationId: "backfill-otel-tenant-environment",
			},
		});
	});

	it("skips when the migration already ran", async () => {
		(prisma.clickhouseMigrations.findFirst as jest.Mock).mockResolvedValue({
			id: "mig-1",
		});
		await expect(
			BackfillOtelTenantEnvironmentMigration("db-1")
		).resolves.toEqual({ migrationExist: true, queriesRun: false });
		expect(dataCollector).not.toHaveBeenCalled();
	});
});
