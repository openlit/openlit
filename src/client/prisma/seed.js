const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
	console.log("Seeding Start.....");
	// const defaultPassword = "openlituser"; ⤵
	const hashedPassword =
		"$2a$10$gh6Odw7fhLRrE1A1OxaHfeWOWKiZEEQpkOAhhCQ.RHx8VWOngwlHO";
	const user = await prisma.user.upsert({
		where: { email: "user@openlit.io" },
		update: {
			hasCompletedOnboarding: true,
		},
		create: {
			email: "user@openlit.io",
			password: hashedPassword,
			name: "User",
			hasCompletedOnboarding: true,
		},
	});

	// Create default organisation
	const defaultOrg = await prisma.organisation.upsert({
		where: { slug: "default" },
		update: {},
		create: {
			name: "Default Organisation",
			slug: "default",
			createdByUserId: user.id,
		},
	});

	// Link user to default organisation as the owner. The `role` column
	// defaults to `member` at the schema level; the seed user is the
	// org creator and must have elevated permissions or downstream
	// privacy gates (e.g. coding-agents COHORT_K_FLOOR) silently
	// suppress their own data. Existing rows are upgraded too.
	await prisma.organisationUser.upsert({
		where: {
			organisationId_userId: {
				organisationId: defaultOrg.id,
				userId: user.id,
			},
		},
		update: {
			role: "owner",
			isCurrent: true,
		},
		create: {
			organisationId: defaultOrg.id,
			userId: user.id,
			role: "owner",
			isCurrent: true,
		},
	});

	const defaultProject = await prisma.project.upsert({
		where: {
			organisationId_slug: {
				organisationId: defaultOrg.id,
				slug: "default",
			},
		},
		update: {
			isDefault: true,
		},
		create: {
			organisationId: defaultOrg.id,
			name: "Default Project",
			slug: "default",
			isDefault: true,
		},
	});

	await prisma.organisationUser.update({
		where: {
			organisationId_userId: {
				organisationId: defaultOrg.id,
				userId: user.id,
			},
		},
		data: {
			currentProjectId: defaultProject.id,
		},
	});

	const environmentDBConfig = {
		username: process.env.INIT_DB_USERNAME || "default",
		password: process.env.INIT_DB_PASSWORD || "",
		host: process.env.INIT_DB_HOST,
		port: process.env.INIT_DB_PORT,
		database: process.env.INIT_DB_DATABASE || "default",
	};

	if (environmentDBConfig.host && environmentDBConfig.port) {
		// First, migrate any orphaned "Default DB" configs to the default project.
		// This must happen before the upsert so existing installs keep references.
		const orphanedDefaultDBConfigs = await prisma.databaseConfig.findMany({
			where: {
				name: "Default DB",
				projectId: null,
			},
		});

		if (orphanedDefaultDBConfigs.length > 0) {
			// Check if a "Default DB" config already exists in the default project.
			const existingDefaultDB = await prisma.databaseConfig.findUnique({
				where: {
					name_projectId: {
						name: "Default DB",
						projectId: defaultProject.id,
					},
				},
			});

			if (existingDefaultDB) {
				// If one exists, we need to handle the orphaned configs
				// Delete only orphaned configs that have no databaseconfiguser references
				for (const orphanedConfig of orphanedDefaultDBConfigs) {
					const hasReferences = await prisma.databaseConfigUser.findFirst({
						where: { databaseConfigId: orphanedConfig.id },
					});

					if (!hasReferences) {
						// Safe to delete - no foreign key constraints
						await prisma.databaseConfig.delete({
							where: { id: orphanedConfig.id },
						});
					} else {
						// Has references - migrate it by updating to a unique name.
						await prisma.databaseConfig.update({
							where: { id: orphanedConfig.id },
							data: {
								name: `Default DB (${orphanedConfig.id.slice(0, 8)})`,
								projectId: defaultProject.id,
							},
						});
					}
				}
			} else {
				// No existing "Default DB" in default project - safe to migrate all orphaned ones.
				await prisma.databaseConfig.updateMany({
					where: {
						name: "Default DB",
						projectId: null,
					},
					data: { projectId: defaultProject.id },
				});
			}
		}

		const dbConfig = await prisma.databaseConfig.upsert({
			where: {
				name_projectId: {
					name: "Default DB",
					projectId: defaultProject.id,
				},
			},
			update: environmentDBConfig,
			create: {
				environment: "production",
				name: "Default DB",
				...environmentDBConfig,
				createdByUserId: user.id,
				projectId: defaultProject.id,
			},
		});

		await prisma.databaseConfigUser.upsert({
			where: {
				databaseConfigId_userId: {
					userId: user.id,
					databaseConfigId: dbConfig.id,
				},
			},
			update: {},
			create: {
				userId: user.id,
				databaseConfigId: dbConfig.id,
				isCurrent: true,
				canEdit: true,
				canDelete: true,
				canShare: true,
			},
		});
	}

	// Migrate existing data if needed (for upgrades)
	await migrateExistingData(defaultOrg.id, defaultProject.id, user.id);

	console.log("Seeding End.....");
}

// Migration logic for existing installations.
// Migrates ALL orphaned configs into the default project, then ensures
// all users sharing configs in the default org are also members.
async function migrateExistingData(defaultOrgId, defaultProjectId, seedUserId) {
	// Step 1: Move ALL orphaned DB configs into the default project.
	// This ensures no user loses access to their configs when they join/create an org
	const allOrphanedConfigs = await prisma.databaseConfig.findMany({
		where: {
			projectId: null,
		},
		select: { id: true, name: true },
	});

	if (allOrphanedConfigs.length > 0) {
		let migratedConfigCount = 0;

		for (const config of allOrphanedConfigs) {
			const existingConfigWithName = await prisma.databaseConfig.findUnique({
				where: {
					name_projectId: {
						name: config.name,
						projectId: defaultProjectId,
					},
				},
			});

			if (existingConfigWithName) {
				await prisma.databaseConfig.update({
					where: { id: config.id },
					data: {
						name: `${config.name} (${config.id.slice(0, 8)})`,
						projectId: defaultProjectId,
					},
				});
			} else {
				await prisma.databaseConfig.update({
					where: { id: config.id },
					data: { projectId: defaultProjectId },
				});
			}

			migratedConfigCount++;
		}

		console.log(
			`Migrated ${migratedConfigCount} orphaned database configs to default project`
		);
	}

	// Step 2: Find ALL configs now in the default project and ensure shared users are members.
	const orgConfigs = await prisma.databaseConfig.findMany({
		where: { projectId: defaultProjectId },
		select: { id: true },
	});

	if (orgConfigs.length === 0) return;

	const orgConfigIds = orgConfigs.map((c) => c.id);

	// Find users who have access to these configs but aren't in the default org
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

		// Check if the user already has any current org
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
			// Existing membership but no current org — fix it
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
}
main()
	.then(async () => {
		await prisma.$disconnect();
	})
	.catch(async (e) => {
		console.error(e);
		await prisma.$disconnect();
	});
