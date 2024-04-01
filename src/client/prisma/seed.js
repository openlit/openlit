const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
	console.log("Inside seeding.....");
	// const defaultPassword = "dokulabsuser"; ⤵
	const hashedPassword =
		"$2a$10$XmL4Q45wWgPzMJXlM5L70eFyYvUGgIeRRm5f4.OOlcaIM/sQB6j/S";
	const user = await prisma.user.upsert({
		where: { email: "user@dokulabs.com" },
		update: {},
		create: {
			email: "user@dokulabs.com",
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
