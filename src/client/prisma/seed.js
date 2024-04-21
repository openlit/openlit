const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
	console.log("Inside seeding.....");
	// const defaultPassword = "openlitlabsuser"; ⤵
	const hashedPassword =
		"$2a$10$oYqdiSB.FPPTJPvKPFh2oe2aMTlGOPyJTuO/WoPDOtX8UTLAo0bPS";
	const user = await prisma.user.upsert({
		where: { email: "user@openlit.io" },
		update: {},
		create: {
			email: "user@openlit.io",
			password: hashedPassword,
			name: "User",
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
			where: { name: "Default DB", AND: { createdByUserId: user.id } },
			update: {},
			create: {
				environment: "production",
				name: "Default DB",
				...environmentDBConfig,
				createdByUserId: user.id,
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
			},
		});
	}
	console.log("Seeding End.....");
}
main()
	.then(async () => {
		await prisma.$disconnect();
	})
	.catch(async (e) => {
		console.error(e);
		await prisma.$disconnect();
	});
