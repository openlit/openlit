import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
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

	const dbConfig = await prisma.databaseConfig.upsert({
		where: { name: "Default DB", AND: { createdByUserId: user.id } },
		update: {},
		create: {
			environment: "production",
			name: "Default DB",
			username: "default",
			password: "DOKU",
			host: "127.0.0.1",
			port: "8123",
			database: "default",
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
main()
	.then(async () => {
		await prisma.$disconnect();
	})
	.catch(async (e) => {
		console.error(e);
		await prisma.$disconnect();
		process.exit(1);
	});
