const { PrismaClient } = require("@prisma/client");
const {
	readInitDbConfig,
	hasInitDb,
	ensureProjectEnvironment,
	upsertDefaultDatabaseConfig,
	migrateExistingData,
} = require("./seed-lib");

const prisma = new PrismaClient();

async function main() {
	console.log("Seeding Start.....");
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

	const defaultOrg = await prisma.organisation.upsert({
		where: { slug: "default" },
		update: {},
		create: {
			name: "Default Organisation",
			slug: "default",
			createdByUserId: user.id,
		},
	});

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

	// Fresh and upgraded installs always get a production environment row so
	// connector/environment UIs and bindings have a stable target.
	await ensureProjectEnvironment(prisma, defaultProject.id, "production");

	const initDb = readInitDbConfig(process.env);
	if (hasInitDb(initDb)) {
		await upsertDefaultDatabaseConfig(prisma, {
			userId: user.id,
			projectId: defaultProject.id,
			initDb,
		});
	}

	// Upgrade path: attach orphaned configs and backfill connectors/bindings.
	await migrateExistingData(prisma, defaultOrg.id, defaultProject.id, user.id);

	console.log("Seeding End.....");
}

main()
	.then(async () => {
		await prisma.$disconnect();
	})
	.catch(async (e) => {
		console.error(e);
		await prisma.$disconnect();
		process.exitCode = 1;
	});
