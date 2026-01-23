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
	await migrateExistingData(user.id, defaultOrg.id);

	console.log("Seeding End.....");
}

// Migration logic for existing installations
async function migrateExistingData(defaultUserId, defaultOrgId) {
	// Find all users not yet linked to any organisation
	const usersWithoutOrg = await prisma.user.findMany({
		where: {
			organisations: {
				none: {},
			},
		},
	});

	// Add all orphaned users to the default organisation
	for (const user of usersWithoutOrg) {
		await prisma.organisationUser.create({
			data: {
				organisationId: defaultOrgId,
				userId: user.id,
				isCurrent: true,
			},
		});

		// Mark as onboarded since they're existing users
		await prisma.user.update({
			where: { id: user.id },
			data: { hasCompletedOnboarding: true },
		});
	}

	// Move all database configs without an organisation to the default org
	await prisma.databaseConfig.updateMany({
		where: { organisationId: null },
		data: { organisationId: defaultOrgId },
	});
}
main()
	.then(async () => {
		await prisma.$disconnect();
	})
	.catch(async (e) => {
		console.error(e);
		await prisma.$disconnect();
	});
