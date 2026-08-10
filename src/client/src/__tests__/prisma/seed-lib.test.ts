/**
 * @jest-environment node
 *
 * Fresh-install vs upgrade/backward-compat coverage for image seeding:
 * connectors, environments, and signal bindings.
 */

const {
	DEFAULT_ENVIRONMENT,
	DEFAULT_DB_NAME,
	DEFAULT_SIGNALS,
	databaseConnectorId,
	readInitDbConfig,
	hasInitDb,
	ensureProjectEnvironment,
	ensureEnvironmentDatabaseBindings,
	syncDatabaseConfigConnector,
	migrateOrphanedDefaultDb,
	upsertDefaultDatabaseConfig,
	migrateExistingData,
} = require("../../../prisma/seed-lib");

function createPrismaMock() {
	return {
		databaseConfig: {
			findMany: jest.fn().mockResolvedValue([]),
			findUnique: jest.fn().mockResolvedValue(null),
			findFirst: jest.fn().mockResolvedValue(null),
			upsert: jest.fn(),
			update: jest.fn(),
			updateMany: jest.fn(),
			delete: jest.fn(),
		},
		databaseConfigUser: {
			findFirst: jest.fn().mockResolvedValue(null),
			findMany: jest.fn().mockResolvedValue([]),
			upsert: jest.fn(),
		},
		projectEnvironment: {
			upsert: jest.fn(),
		},
		telemetrySourceBinding: {
			upsert: jest.fn(),
		},
		connectorInstance: {
			upsert: jest.fn(),
		},
		organisationUser: {
			findUnique: jest.fn().mockResolvedValue(null),
			findFirst: jest.fn().mockResolvedValue(null),
			create: jest.fn(),
			update: jest.fn(),
		},
		user: {
			update: jest.fn(),
		},
	};
}

describe("seed-lib INIT_DB helpers", () => {
	it("reads INIT_DB_* for fresh compose installs", () => {
		const config = readInitDbConfig({
			INIT_DB_HOST: "clickhouse",
			INIT_DB_PORT: "8123",
			INIT_DB_USERNAME: "default",
			INIT_DB_PASSWORD: "OPENLIT",
			INIT_DB_DATABASE: "openlit",
		});
		expect(hasInitDb(config)).toBe(true);
		expect(config).toEqual({
			username: "default",
			password: "OPENLIT",
			host: "clickhouse",
			port: "8123",
			database: "openlit",
		});
	});

	it("treats missing host/port as no seeded ClickHouse (fresh UI path)", () => {
		expect(hasInitDb(readInitDbConfig({}))).toBe(false);
		expect(hasInitDb(readInitDbConfig({ INIT_DB_HOST: "only-host" }))).toBe(false);
	});
});

describe("fresh user initiation with INIT_DB_*", () => {
	it("creates Default DB, production env, all signal bindings, and connector projection", async () => {
		const prisma = createPrismaMock();
		const created = {
			id: "db-1",
			name: DEFAULT_DB_NAME,
			projectId: "project-1",
			environment: DEFAULT_ENVIRONMENT,
			username: "default",
			password: "OPENLIT",
			host: "clickhouse",
			port: "8123",
			database: "openlit",
			query: "",
		};
		prisma.databaseConfig.upsert.mockResolvedValue(created);
		prisma.databaseConfigUser.upsert.mockResolvedValue({});
		prisma.projectEnvironment.upsert.mockResolvedValue({});
		prisma.telemetrySourceBinding.upsert.mockResolvedValue({});
		prisma.connectorInstance.upsert.mockResolvedValue({});

		const result = await upsertDefaultDatabaseConfig(prisma, {
			userId: "user-1",
			projectId: "project-1",
			initDb: {
				username: "default",
				password: "OPENLIT",
				host: "clickhouse",
				port: "8123",
				database: "openlit",
			},
		});

		expect(result).toEqual(created);
		expect(prisma.databaseConfig.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					name_projectId_environment: {
						name: DEFAULT_DB_NAME,
						projectId: "project-1",
						environment: DEFAULT_ENVIRONMENT,
					},
				},
				// Fresh create uses INIT_DB_*; upgrades must not wipe UI edits.
				update: {},
				create: expect.objectContaining({
					environment: DEFAULT_ENVIRONMENT,
					name: DEFAULT_DB_NAME,
					host: "clickhouse",
					projectId: "project-1",
					createdByUserId: "user-1",
				}),
			})
		);

		expect(prisma.projectEnvironment.upsert).toHaveBeenCalledWith({
			where: { projectId_name: { projectId: "project-1", name: "production" } },
			create: { projectId: "project-1", name: "production" },
			update: {},
		});

		expect(prisma.telemetrySourceBinding.upsert).toHaveBeenCalledTimes(
			DEFAULT_SIGNALS.length
		);
		for (const signal of DEFAULT_SIGNALS) {
			expect(prisma.telemetrySourceBinding.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					where: {
						projectId_signal_environment: {
							projectId: "project-1",
							signal,
							environment: "production",
						},
					},
					create: expect.objectContaining({
						databaseConfigId: "db-1",
						signal,
						environment: "production",
					}),
					update: {},
				})
			);
		}

		expect(prisma.connectorInstance.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: databaseConnectorId("db-1") },
				create: expect.objectContaining({
					type: "clickhouse",
					environment: "production",
					projectId: "project-1",
					status: "active",
				}),
			})
		);
	});

	it("skips Default DB when INIT_DB_* is absent (fresh user adds connectors later)", async () => {
		const prisma = createPrismaMock();
		const result = await upsertDefaultDatabaseConfig(prisma, {
			userId: "user-1",
			projectId: "project-1",
			initDb: { host: "", port: "" },
		});
		expect(result).toBeNull();
		expect(prisma.databaseConfig.upsert).not.toHaveBeenCalled();
	});
});

describe("backward compatibility / upgrade volume", () => {
	it("migrates orphaned Default DB using name_projectId_environment", async () => {
		const prisma = createPrismaMock();
		prisma.databaseConfig.findMany.mockResolvedValue([
			{ id: "orphan-1", name: DEFAULT_DB_NAME, projectId: null },
		]);
		prisma.databaseConfig.findUnique.mockResolvedValue(null);
		prisma.databaseConfig.updateMany.mockResolvedValue({ count: 1 });

		await migrateOrphanedDefaultDb(prisma, "project-1");

		expect(prisma.databaseConfig.updateMany).toHaveBeenCalledWith({
			where: { name: DEFAULT_DB_NAME, projectId: null },
			data: { projectId: "project-1", environment: DEFAULT_ENVIRONMENT },
		});
	});

	it("renames colliding orphaned configs instead of deleting referenced ones", async () => {
		const prisma = createPrismaMock();
		prisma.databaseConfig.findMany.mockResolvedValue([
			{ id: "orphan-abc12345", name: DEFAULT_DB_NAME, projectId: null, environment: "production" },
		]);
		prisma.databaseConfig.findUnique.mockResolvedValue({ id: "existing-default" });
		prisma.databaseConfigUser.findFirst.mockResolvedValue({ id: "link-1" });
		prisma.databaseConfig.update.mockResolvedValue({});

		await migrateOrphanedDefaultDb(prisma, "project-1");

		expect(prisma.databaseConfig.delete).not.toHaveBeenCalled();
		expect(prisma.databaseConfig.update).toHaveBeenCalledWith({
			where: { id: "orphan-abc12345" },
			data: {
				name: "Default DB (orphan-a)",
				projectId: "project-1",
				environment: "production",
			},
		});
	});

	it("backfills connectors and production bindings for upgraded project configs", async () => {
		const prisma = createPrismaMock();
		prisma.databaseConfig.findMany
			.mockResolvedValueOnce([]) // orphaned
			.mockResolvedValueOnce([
				{
					id: "db-legacy",
					name: "Default DB",
					username: "default",
					host: "clickhouse",
					port: "8123",
					database: "openlit",
					query: "",
					environment: "production",
					projectId: "project-1",
				},
			]);
		prisma.projectEnvironment.upsert.mockResolvedValue({});
		prisma.connectorInstance.upsert.mockResolvedValue({});
		prisma.telemetrySourceBinding.upsert.mockResolvedValue({});
		prisma.databaseConfigUser.findMany.mockResolvedValue([]);

		const result = await migrateExistingData(
			prisma,
			"org-1",
			"project-1",
			"seed-user"
		);

		expect(result.migratedConfigCount).toBe(0);
		expect(prisma.connectorInstance.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: databaseConnectorId("db-legacy") },
			})
		);
		expect(prisma.telemetrySourceBinding.upsert).toHaveBeenCalledTimes(
			DEFAULT_SIGNALS.length
		);
	});

	it("moves orphaned configs into the default project on upgrade", async () => {
		const prisma = createPrismaMock();
		prisma.databaseConfig.findMany
			.mockResolvedValueOnce([
				{ id: "orphan-2", name: "Legacy CH", environment: null },
			])
			.mockResolvedValueOnce([
				{
					id: "orphan-2",
					name: "Legacy CH",
					username: "default",
					host: "ch",
					port: "8123",
					database: "default",
					query: "",
					environment: "production",
					projectId: "project-1",
				},
			]);
		prisma.databaseConfig.findUnique.mockResolvedValue(null);
		prisma.databaseConfig.update.mockResolvedValue({});
		prisma.projectEnvironment.upsert.mockResolvedValue({});
		prisma.connectorInstance.upsert.mockResolvedValue({});
		prisma.telemetrySourceBinding.upsert.mockResolvedValue({});
		prisma.databaseConfigUser.findMany.mockResolvedValue([]);

		const result = await migrateExistingData(
			prisma,
			"org-1",
			"project-1",
			"seed-user"
		);

		expect(result.migratedConfigCount).toBe(1);
		expect(prisma.databaseConfig.update).toHaveBeenCalledWith({
			where: { id: "orphan-2" },
			data: { projectId: "project-1", environment: "production" },
		});
	});
});

describe("environment + connector helpers", () => {
	it("ensures production environment upsert shape", async () => {
		const prisma = createPrismaMock();
		await ensureProjectEnvironment(prisma, "project-1");
		expect(prisma.projectEnvironment.upsert).toHaveBeenCalledWith({
			where: { projectId_name: { projectId: "project-1", name: "production" } },
			create: { projectId: "project-1", name: "production" },
			update: {},
		});
	});

	it("projects clickhouse connector settings without secrets in settings JSON", async () => {
		const prisma = createPrismaMock();
		prisma.connectorInstance.upsert.mockResolvedValue({});
		await syncDatabaseConfigConnector(prisma, {
			id: "db-1",
			name: "Default DB",
			username: "default",
			password: "secret",
			host: "clickhouse",
			port: "8123",
			database: "openlit",
			query: "",
			environment: "production",
			projectId: "project-1",
		});
		const call = prisma.connectorInstance.upsert.mock.calls[0][0];
		const settings = JSON.parse(call.create.settings);
		expect(settings).toEqual({
			username: "default",
			host: "clickhouse",
			port: "8123",
			database: "openlit",
			query: "",
		});
		expect(settings.password).toBeUndefined();
	});

	it("binding helper covers all default signals including intelligence", async () => {
		const prisma = createPrismaMock();
		prisma.telemetrySourceBinding.upsert.mockResolvedValue({});
		await ensureEnvironmentDatabaseBindings(prisma, "p1", "db1");
		expect(prisma.telemetrySourceBinding.upsert).toHaveBeenCalledTimes(4);
		expect(DEFAULT_SIGNALS).toEqual([
			"traces",
			"logs",
			"metrics",
			"intelligence",
		]);
	});
});
