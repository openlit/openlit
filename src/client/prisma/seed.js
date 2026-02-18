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

	// Link user to default organisation
	await prisma.organisationUser.upsert({
		where: {
			organisationId_userId: {
				organisationId: defaultOrg.id,
				userId: user.id,
			},
		},
		update: {},
		create: {
			organisationId: defaultOrg.id,
			userId: user.id,
			isCurrent: true,
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
		const dbConfig = await prisma.databaseConfig.upsert({
			where: {
				name_organisationId: {
					name: "Default DB",
					organisationId: defaultOrg.id,
				},
			},
			update: {},
			create: {
				environment: "production",
				name: "Default DB",
				...environmentDBConfig,
				createdByUserId: user.id,
				organisationId: defaultOrg.id,
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
	await migrateExistingData(defaultOrg.id, user.id);

	console.log("Seeding End.....");
}

// Migration logic for existing installations
// Migrates ALL orphaned configs into the default org, then ensures
// all users sharing configs in the default org are also members.
async function migrateExistingData(defaultOrgId, seedUserId) {
	// Step 1: Move ALL orphaned DB configs into the default org
	// This ensures no user loses access to their configs when they join/create an org
	const allOrphanedConfigs = await prisma.databaseConfig.findMany({
		where: {
			organisationId: null,
		},
		select: { id: true },
	});

	if (allOrphanedConfigs.length > 0) {
		const orphanedConfigIds = allOrphanedConfigs.map((config) => config.id);

		await prisma.databaseConfig.updateMany({
			where: { id: { in: orphanedConfigIds } },
			data: { organisationId: defaultOrgId },
		});

		console.log(
			`Migrated ${orphanedConfigIds.length} orphaned database configs to default organisation`
		);
	}

	// Step 2: Find ALL configs now in the default org and ensure shared users are members
	const orgConfigs = await prisma.databaseConfig.findMany({
		where: { organisationId: defaultOrgId },
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
				data: { isCurrent: true },
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
