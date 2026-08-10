/**
 * Seed helpers shared by prisma/seed.js and unit tests.
 * Covers fresh INIT_DB_* bootstrap and upgrade-safe orphan migration.
 */

const DEFAULT_ENVIRONMENT = "production";
const DEFAULT_DB_NAME = "Default DB";
const DEFAULT_SIGNALS = ["traces", "logs", "metrics", "intelligence"];

function databaseConnectorId(id) {
	return `database:${id}`;
}

function readInitDbConfig(env = process.env) {
	return {
		username: env.INIT_DB_USERNAME || "default",
		password: env.INIT_DB_PASSWORD || "",
		host: env.INIT_DB_HOST,
		port: env.INIT_DB_PORT,
		database: env.INIT_DB_DATABASE || "default",
	};
}

function hasInitDb(config) {
	return Boolean(config && config.host && config.port);
}

async function ensureProjectEnvironment(prisma, projectId, name = DEFAULT_ENVIRONMENT) {
	return prisma.projectEnvironment.upsert({
		where: { projectId_name: { projectId, name } },
		create: { projectId, name },
		update: {},
	});
}

async function ensureEnvironmentDatabaseBindings(
	prisma,
	projectId,
	databaseConfigId,
	environment = DEFAULT_ENVIRONMENT,
	signals = DEFAULT_SIGNALS
) {
	for (const signal of signals) {
		await prisma.telemetrySourceBinding.upsert({
			where: {
				projectId_signal_environment: { projectId, signal, environment },
			},
			create: {
				projectId,
				signal,
				environment,
				databaseConfigId,
			},
			// Preserve day-2 routing changes made in the UI.
			update: {},
		});
	}
}

async function syncDatabaseConfigConnector(prisma, config) {
	if (!config?.id || !prisma.connectorInstance?.upsert) return null;
	const settings = JSON.stringify({
		username: config.username,
		host: config.host,
		port: config.port,
		database: config.database,
		query: config.query || "",
	});
	return prisma.connectorInstance.upsert({
		where: { id: databaseConnectorId(config.id) },
		create: {
			id: databaseConnectorId(config.id),
			category: "datasource",
			type: "clickhouse",
			name: config.name,
			environment: config.environment || DEFAULT_ENVIRONMENT,
			projectId: config.projectId,
			settings,
			status: "active",
			metadata: JSON.stringify({
				legacyKind: "database-config",
				legacyId: config.id,
			}),
		},
		update: {
			name: config.name,
			environment: config.environment || DEFAULT_ENVIRONMENT,
			projectId: config.projectId,
			settings,
			status: "active",
		},
	});
}

/**
 * Move pre-project "Default DB" rows into the default project before upsert.
 */
async function migrateOrphanedDefaultDb(prisma, defaultProjectId) {
	const orphanedDefaultDBConfigs = await prisma.databaseConfig.findMany({
		where: { name: DEFAULT_DB_NAME, projectId: null },
	});
	if (orphanedDefaultDBConfigs.length === 0) return;

	const existingDefaultDB = await prisma.databaseConfig.findUnique({
		where: {
			name_projectId_environment: {
				name: DEFAULT_DB_NAME,
				projectId: defaultProjectId,
				environment: DEFAULT_ENVIRONMENT,
			},
		},
	});

	if (existingDefaultDB) {
		for (const orphanedConfig of orphanedDefaultDBConfigs) {
			const hasReferences = await prisma.databaseConfigUser.findFirst({
				where: { databaseConfigId: orphanedConfig.id },
			});
			if (!hasReferences) {
				await prisma.databaseConfig.delete({ where: { id: orphanedConfig.id } });
			} else {
				await prisma.databaseConfig.update({
					where: { id: orphanedConfig.id },
					data: {
						name: `Default DB (${orphanedConfig.id.slice(0, 8)})`,
						projectId: defaultProjectId,
						environment: orphanedConfig.environment || DEFAULT_ENVIRONMENT,
					},
				});
			}
		}
		return;
	}

	await prisma.databaseConfig.updateMany({
		where: { name: DEFAULT_DB_NAME, projectId: null },
		data: { projectId: defaultProjectId, environment: DEFAULT_ENVIRONMENT },
	});
}

/**
 * Fresh install: create Default DB from INIT_DB_*.
 * Upgrade/restart: do not overwrite connection fields already stored in SQLite
 * (day-2 UI edits must survive container recreates with the same volume).
 */
async function upsertDefaultDatabaseConfig(prisma, { userId, projectId, initDb }) {
	if (!hasInitDb(initDb)) return null;

	await migrateOrphanedDefaultDb(prisma, projectId);

	const dbConfig = await prisma.databaseConfig.upsert({
		where: {
			name_projectId_environment: {
				name: DEFAULT_DB_NAME,
				projectId,
				environment: DEFAULT_ENVIRONMENT,
			},
		},
		// Preserve existing host/user/password/database on upgrades.
		update: {},
		create: {
			environment: DEFAULT_ENVIRONMENT,
			name: DEFAULT_DB_NAME,
			username: initDb.username,
			password: initDb.password,
			host: initDb.host,
			port: initDb.port,
			database: initDb.database,
			createdByUserId: userId,
			projectId,
		},
	});

	await prisma.databaseConfigUser.upsert({
		where: {
			databaseConfigId_userId: {
				userId,
				databaseConfigId: dbConfig.id,
			},
		},
		update: {},
		create: {
			userId,
			databaseConfigId: dbConfig.id,
			isCurrent: true,
			canEdit: true,
			canDelete: true,
			canShare: true,
		},
	});

	await ensureProjectEnvironment(prisma, projectId, DEFAULT_ENVIRONMENT);
	await ensureEnvironmentDatabaseBindings(
		prisma,
		projectId,
		dbConfig.id,
		DEFAULT_ENVIRONMENT
	);
	await syncDatabaseConfigConnector(prisma, dbConfig);

	return dbConfig;
}

/**
 * Upgrade path: attach every orphaned databaseConfig to the default project.
 */
async function migrateExistingData(prisma, defaultOrgId, defaultProjectId, seedUserId) {
	const allOrphanedConfigs = await prisma.databaseConfig.findMany({
		where: { projectId: null },
		select: { id: true, name: true, environment: true },
	});

	let migratedConfigCount = 0;
	for (const config of allOrphanedConfigs) {
		const environment = config.environment || DEFAULT_ENVIRONMENT;
		const existingConfigWithName = await prisma.databaseConfig.findUnique({
			where: {
				name_projectId_environment: {
					name: config.name,
					projectId: defaultProjectId,
					environment,
				},
			},
		});

		if (existingConfigWithName) {
			await prisma.databaseConfig.update({
				where: { id: config.id },
				data: {
					name: `${config.name} (${config.id.slice(0, 8)})`,
					projectId: defaultProjectId,
					environment,
				},
			});
		} else {
			await prisma.databaseConfig.update({
				where: { id: config.id },
				data: { projectId: defaultProjectId, environment },
			});
		}
		migratedConfigCount++;
	}

	if (migratedConfigCount > 0) {
		console.log(
			`Migrated ${migratedConfigCount} orphaned database configs to default project`
		);
	}

	const orgConfigs = await prisma.databaseConfig.findMany({
		where: { projectId: defaultProjectId },
		select: { id: true, name: true, username: true, host: true, port: true, database: true, query: true, environment: true, projectId: true },
	});
	if (orgConfigs.length === 0) return { migratedConfigCount: 0 };

	await ensureProjectEnvironment(prisma, defaultProjectId, DEFAULT_ENVIRONMENT);

	for (const config of orgConfigs) {
		await syncDatabaseConfigConnector(prisma, config);
		if ((config.environment || DEFAULT_ENVIRONMENT) === DEFAULT_ENVIRONMENT) {
			await ensureEnvironmentDatabaseBindings(
				prisma,
				defaultProjectId,
				config.id,
				DEFAULT_ENVIRONMENT
			);
		}
	}

	const orgConfigIds = orgConfigs.map((c) => c.id);
	const sharedUserLinks = await prisma.databaseConfigUser.findMany({
		where: {
			databaseConfigId: { in: orgConfigIds },
			userId: { not: seedUserId },
		},
		select: { userId: true },
		distinct: ["userId"],
	});

	for (const { userId } of sharedUserLinks) {
		const existingMembership = await prisma.organisationUser.findUnique({
			where: {
				organisationId_userId: {
					organisationId: defaultOrgId,
					userId,
				},
			},
		});

		const hasCurrentOrg = await prisma.organisationUser.findFirst({
			where: { userId, isCurrent: true },
		});

		if (!existingMembership) {
			await prisma.organisationUser.create({
				data: {
					organisationId: defaultOrgId,
					userId,
					isCurrent: !hasCurrentOrg,
					currentProjectId: defaultProjectId,
				},
			});
		} else if (!hasCurrentOrg) {
			await prisma.organisationUser.update({
				where: {
					organisationId_userId: {
						organisationId: defaultOrgId,
						userId,
					},
				},
				data: {
					isCurrent: true,
					currentProjectId: defaultProjectId,
				},
			});
		} else if (!existingMembership.currentProjectId) {
			await prisma.organisationUser.update({
				where: {
					organisationId_userId: {
						organisationId: defaultOrgId,
						userId,
					},
				},
				data: { currentProjectId: defaultProjectId },
			});
		}

		await prisma.user.update({
			where: { id: userId },
			data: { hasCompletedOnboarding: true },
		});
	}

	return { migratedConfigCount };
}

module.exports = {
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
};
