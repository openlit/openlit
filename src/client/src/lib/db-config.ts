import prisma from "./prisma";
import { getCurrentUser } from "./session";
import { DatabaseConfig } from "@prisma/client";

export const getDBConfigByUser = async (currentOnly?: boolean) => {
	const user = await getCurrentUser();

	if (!user) throw new Error("Unauthorized user!");

	if (currentOnly) {
		const dbConfig = await prisma.databaseConfigUser.findFirst({
			where: {
				userId: user.id,
				isCurrent: true,
			},
			select: {
				databaseConfig: true,
			},
		});
		return dbConfig?.databaseConfig;
	}

	const dbUserConfigs = await prisma.databaseConfigUser.findMany({
		where: {
			userId: user.id,
		},
		select: {
			databaseConfigId: true,
			isCurrent: true,
			databaseConfig: true,
		},
		orderBy: {
			databaseConfig: {
				createdAt: "asc",
			},
		},
	});

	const dbConfigs = dbUserConfigs.map((dbConfig) => dbConfig.databaseConfig);
	const currentConfig = dbUserConfigs.find((dbConfig) => dbConfig.isCurrent);
	return dbConfigs.map((dbConfig) => ({
		...dbConfig,
		isCurrent: currentConfig?.databaseConfigId === dbConfig?.id,
	}));
};

export const getDBConfigById = async ({ id }: { id: string }) => {
	return await prisma.databaseConfig.findUnique({
		where: {
			id,
		},
	});
};

export const upsertDBConfig = async (
	dbConfig: Partial<DatabaseConfig>,
	id?: string
) => {
	if (!dbConfig.name) throw new Error("No name provided");
	if (!dbConfig.username) throw new Error("No username provided");
	if (!dbConfig.host) throw new Error("No host provided");
	if (!dbConfig.port) throw new Error("No port provided");
	if (!dbConfig.database) throw new Error("No database provided");
	if (!dbConfig.database) throw new Error("No database provided");

	const user = await getCurrentUser();

	if (!user) throw new Error("Unauthorized user!");

	const existingDBName = await prisma.databaseConfig.findUnique({
		where: {
			name: dbConfig.name,
			NOT: {
				id,
			},
		},
	});

	if (existingDBName?.id) throw new Error("DB config Name already exists");

	const whereObject: any = {};
	if (id) whereObject.id = id;
	else whereObject.name = dbConfig.name;

	const createddbConfig = await prisma.databaseConfig.upsert({
		where: whereObject,
		create: {
			...(dbConfig as any),
			createdByUserId: user.id,
		},
		update: {
			...dbConfig,
		},
	});

	if (!id) {
		const ifFirstDBConfigCreated = await prisma.databaseConfigUser.count({
			where: {
				userId: user.id,
			},
		});
		await prisma.databaseConfigUser.create({
			data: {
				userId: user.id,
				databaseConfigId: createddbConfig.id,
				isCurrent: !ifFirstDBConfigCreated,
			},
		});
	}

	return `${id ? "Updated" : "Added"} db details successfully`;
};

export async function deleteDBConfig(id: string) {
	const user = await getCurrentUser();

	if (!user) throw new Error("Unauthorized user!");

	await prisma.databaseConfigUser.delete({
		where: {
			databaseConfigId_userId: {
				userId: user.id,
				databaseConfigId: id,
			},
		},
	});

	await prisma.databaseConfig.delete({
		where: {
			id,
		},
	});

	return "Deleted successfully!";
}

export async function setCurrentDBConfig(id: string) {
	const user = await getCurrentUser();

	if (!user) throw new Error("Unauthorized user!");

	const currentConfig = await getDBConfigByUser(true);

	await prisma.databaseConfigUser.update({
		where: {
			databaseConfigId_userId: {
				userId: user.id,
				databaseConfigId: (currentConfig as DatabaseConfig).id,
			},
		},
		data: {
			isCurrent: false,
		},
	});

	await prisma.databaseConfigUser.update({
		where: {
			databaseConfigId_userId: {
				userId: user.id,
				databaseConfigId: id,
			},
		},
		data: {
			isCurrent: true,
		},
	});

	return "Current DB config set successfully!";
}
