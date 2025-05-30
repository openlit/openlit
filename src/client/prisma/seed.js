const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const prisma = new PrismaClient();
async function main() {
	console.log("Seeding Start.....");

	const demoEmail = process.env.DEMO_ACCOUNT_EMAIL || "demo@openlit.io";
	const demoPassword = process.env.DEMO_ACCOUNT_PASSWORD || "demouser";
	const hashedPassword = await bcrypt.hash(demoPassword, 10);
	const username = process.env.DEMO_ACCOUNT_NAME || "Demo User";

	const user = await prisma.user.upsert({
		where: { email: demoEmail },
		update: {},
		create: {
			email: demoEmail,
			password: hashedPassword,
			name: username,
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
		const dbConfigName = `${username} DB`;
		const dbConfig = await prisma.databaseConfig.upsert({
			where: { name: dbConfigName },
			update: {},
			create: {
				environment: "production",
				name: dbConfigName,
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
				canEdit: true,
				canDelete: true,
				canShare: true,
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
