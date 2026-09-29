jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		connectorInstance: {
			upsert: jest.fn(),
			deleteMany: jest.fn(),
			findMany: jest.fn(),
		},
		databaseConfig: {
			findMany: jest.fn(),
		},
		telemetrySource: {
			findMany: jest.fn(),
		},
	},
}));

import prisma from "@/lib/prisma";
import {
	syncDatabaseConfigConnector,
	syncTelemetrySourceConnector,
	removeLegacyConnector,
	listProjectConnectorInstances,
} from "@/lib/platform/connectors/instances";
import type { DatabaseConfig, TelemetrySource } from "@prisma/client";

beforeEach(() => {
	jest.clearAllMocks();
});

const baseDatabaseConfig = {
	id: "db-1",
	username: "user",
	host: "localhost",
	port: 8123,
	database: "default",
	query: "",
	name: "My DB",
	environment: "production",
	projectId: "project-1",
} as unknown as DatabaseConfig;

const baseTelemetrySource = {
	id: "ts-1",
	type: "grafana",
	name: "My Source",
	environment: "production",
	projectId: "project-1",
	settings: '{"url":"http://x"}',
	secretRef: null,
	signals: "traces,logs",
	isDefault: false,
} as unknown as TelemetrySource;

describe("syncDatabaseConfigConnector", () => {
	it("upserts a connector using the database: prefix and default settings", async () => {
		(prisma.connectorInstance.upsert as jest.Mock).mockResolvedValue({});

		await syncDatabaseConfigConnector(baseDatabaseConfig);

		expect(prisma.connectorInstance.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "database:db-1" },
				create: expect.objectContaining({
					id: "database:db-1",
					category: "datasource",
					type: "clickhouse",
					name: "My DB",
					environment: "production",
					projectId: "project-1",
					status: "active",
				}),
				update: expect.objectContaining({
					name: "My DB",
					environment: "production",
					projectId: "project-1",
					status: "active",
				}),
			})
		);
		const call = (prisma.connectorInstance.upsert as jest.Mock).mock.calls[0][0];
		const settings = JSON.parse(call.create.settings);
		expect(settings).toEqual({
			username: "user",
			host: "localhost",
			port: 8123,
			database: "default",
			query: "",
		});
	});

	it("defaults environment to production when missing", async () => {
		(prisma.connectorInstance.upsert as jest.Mock).mockResolvedValue({});
		await syncDatabaseConfigConnector({
			...baseDatabaseConfig,
			environment: "" as any,
		});
		const call = (prisma.connectorInstance.upsert as jest.Mock).mock.calls[0][0];
		expect(call.create.environment).toBe("production");
		expect(call.update.environment).toBe("production");
	});

	it("defaults query to an empty string when not set", async () => {
		(prisma.connectorInstance.upsert as jest.Mock).mockResolvedValue({});
		await syncDatabaseConfigConnector({
			...baseDatabaseConfig,
			query: null as any,
		});
		const call = (prisma.connectorInstance.upsert as jest.Mock).mock.calls[0][0];
		const settings = JSON.parse(call.create.settings);
		expect(settings.query).toBe("");
	});
});

describe("syncTelemetrySourceConnector", () => {
	it("upserts a connector using the telemetry: prefix", async () => {
		(prisma.connectorInstance.upsert as jest.Mock).mockResolvedValue({});

		await syncTelemetrySourceConnector(baseTelemetrySource);

		expect(prisma.connectorInstance.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "telemetry:ts-1" },
				create: expect.objectContaining({
					id: "telemetry:ts-1",
					category: "datasource",
					type: "grafana",
					name: "My Source",
					environment: "production",
					projectId: "project-1",
					settings: '{"url":"http://x"}',
					secretRef: null,
					status: "active",
				}),
				update: expect.objectContaining({
					type: "grafana",
					name: "My Source",
					settings: '{"url":"http://x"}',
				}),
			})
		);
	});

	it("defaults environment to production and settings to {} when missing", async () => {
		(prisma.connectorInstance.upsert as jest.Mock).mockResolvedValue({});
		await syncTelemetrySourceConnector({
			...baseTelemetrySource,
			environment: "" as any,
			settings: "" as any,
		});
		const call = (prisma.connectorInstance.upsert as jest.Mock).mock.calls[0][0];
		expect(call.create.environment).toBe("production");
		expect(call.create.settings).toBe("{}");
		expect(call.update.environment).toBe("production");
		expect(call.update.settings).toBe("{}");
	});

	it("embeds signals and isDefault flags in metadata", async () => {
		(prisma.connectorInstance.upsert as jest.Mock).mockResolvedValue({});
		await syncTelemetrySourceConnector({
			...baseTelemetrySource,
			signals: "metrics",
			isDefault: true,
		});
		const call = (prisma.connectorInstance.upsert as jest.Mock).mock.calls[0][0];
		const metadata = JSON.parse(call.create.metadata);
		expect(metadata).toEqual(
			expect.objectContaining({
				legacyKind: "telemetry-source",
				legacyId: "ts-1",
				signals: "metrics",
				isDefault: true,
			})
		);
	});
});

describe("removeLegacyConnector", () => {
	it("deletes using the database: prefix for database-config kind", async () => {
		(prisma.connectorInstance.deleteMany as jest.Mock).mockResolvedValue({});
		await removeLegacyConnector("database-config", "db-1");
		expect(prisma.connectorInstance.deleteMany).toHaveBeenCalledWith({
			where: { id: "database:db-1" },
		});
	});

	it("deletes using the telemetry: prefix for telemetry-source kind", async () => {
		(prisma.connectorInstance.deleteMany as jest.Mock).mockResolvedValue({});
		await removeLegacyConnector("telemetry-source", "ts-1");
		expect(prisma.connectorInstance.deleteMany).toHaveBeenCalledWith({
			where: { id: "telemetry:ts-1" },
		});
	});
});

describe("listProjectConnectorInstances", () => {
	beforeEach(() => {
		(prisma.databaseConfig.findMany as jest.Mock).mockResolvedValue([]);
		(prisma.telemetrySource.findMany as jest.Mock).mockResolvedValue([]);
		(prisma.connectorInstance.upsert as jest.Mock).mockResolvedValue({});
	});

	it("backfills connectors from database configs and telemetry sources before reading", async () => {
		(prisma.databaseConfig.findMany as jest.Mock).mockResolvedValue([baseDatabaseConfig]);
		(prisma.telemetrySource.findMany as jest.Mock).mockResolvedValue([baseTelemetrySource]);
		(prisma.connectorInstance.findMany as jest.Mock).mockResolvedValue([]);

		await listProjectConnectorInstances("project-1");

		expect(prisma.connectorInstance.upsert).toHaveBeenCalledTimes(2);
		expect(prisma.connectorInstance.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { projectId: "project-1" } })
		);
	});

	it("gives clickhouse datasource connectors the fixed signal set", async () => {
		(prisma.connectorInstance.findMany as jest.Mock).mockResolvedValue([
			{
				id: "database:db-1",
				category: "datasource",
				type: "clickhouse",
				metadata: JSON.stringify({ legacyKind: "database-config" }),
				secretRef: null,
			},
		]);

		const result = await listProjectConnectorInstances("project-1");
		expect(result[0].signals).toBe("traces,logs,metrics,intelligence");
		expect(result[0].isDefault).toBe(false);
		expect(result[0].hasSecret).toBe(false);
	});

	it("falls back to metadata.signals for non-clickhouse datasource connectors", async () => {
		(prisma.connectorInstance.findMany as jest.Mock).mockResolvedValue([
			{
				id: "telemetry:ts-1",
				category: "datasource",
				type: "grafana",
				metadata: JSON.stringify({ signals: "metrics", isDefault: true }),
				secretRef: "secret-1",
			},
		]);

		const result = await listProjectConnectorInstances("project-1");
		expect(result[0].signals).toBe("metrics");
		expect(result[0].isDefault).toBe(true);
		expect(result[0].hasSecret).toBe(true);
	});

	it("defaults to traces,logs,metrics when metadata has no signals for non-clickhouse connectors", async () => {
		(prisma.connectorInstance.findMany as jest.Mock).mockResolvedValue([
			{
				id: "telemetry:ts-2",
				category: "datasource",
				type: "loki",
				metadata: "{}",
				secretRef: null,
			},
		]);

		const result = await listProjectConnectorInstances("project-1");
		expect(result[0].signals).toBe("traces,logs,metrics");
	});

	it("gives non-datasource connectors an empty signals string and no default flag", async () => {
		(prisma.connectorInstance.findMany as jest.Mock).mockResolvedValue([
			{
				id: "connector-1",
				category: "memory",
				type: "custom-memory",
				metadata: JSON.stringify({ isDefault: true }),
				secretRef: null,
			},
		]);

		const result = await listProjectConnectorInstances("project-1");
		expect(result[0].signals).toBe("");
		expect(result[0].isDefault).toBe(false);
	});

	it("tolerates malformed metadata JSON and keeps sensible defaults", async () => {
		(prisma.connectorInstance.findMany as jest.Mock).mockResolvedValue([
			{
				id: "connector-1",
				category: "datasource",
				type: "grafana",
				metadata: "{not-json",
				secretRef: null,
			},
		]);

		const result = await listProjectConnectorInstances("project-1");
		expect(result[0].signals).toBe("traces,logs,metrics");
		expect(result[0].isDefault).toBe(false);
	});

	it("treats metadata that parses to null (JSON \"null\") as an empty object", async () => {
		(prisma.connectorInstance.findMany as jest.Mock).mockResolvedValue([
			{
				id: "connector-1",
				category: "datasource",
				type: "grafana",
				metadata: "null",
				secretRef: null,
			},
		]);

		const result = await listProjectConnectorInstances("project-1");
		expect(result[0].signals).toBe("traces,logs,metrics");
	});

	it("treats a null metadata field as an empty object", async () => {
		(prisma.connectorInstance.findMany as jest.Mock).mockResolvedValue([
			{
				id: "connector-1",
				category: "datasource",
				type: "grafana",
				metadata: null,
				secretRef: null,
			},
		]);

		const result = await listProjectConnectorInstances("project-1");
		expect(result[0].signals).toBe("traces,logs,metrics");
	});
});
