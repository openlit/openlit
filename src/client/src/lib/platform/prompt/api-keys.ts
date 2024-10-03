import crypto from "crypto";
import { getDBConfigByUser } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { consoleLog } from "@/utils/log";

const APIKEY_PREFIX = "openlit-";

function createAPIKey() {
	// Generate 32 random bytes
	const key = crypto.randomBytes(32);

	// Convert the byte array to a Base64 string
	const apiKey = `${APIKEY_PREFIX}${key.toString("base64")}`;

	return apiKey;
}

export async function generateAPIKey() {
	const user = await getCurrentUser();

	if (!user) throw new Error("Unauthorized user!");

	const [err, dbConfig] = await asaw(getDBConfigByUser(true));

	if (err) throw err;

	if (!dbConfig?.id) throw "No database config present!";

	const apiKey = createAPIKey();

	await prisma.aPIKeys.create({
		data: {
			apiKey,
			databaseConfigId: dbConfig.id,
			createdByUserId: user.id,
		},
	});

	return {
		apiKey,
		databaseConfigId: dbConfig.id,
	};
}

export async function getAPIKeyInfo({ apiKey }: { apiKey: string }) {
	return await asaw(
		prisma.aPIKeys.findFirst({
			where: {
				AND: [
					{
						apiKey,
					},
					{
						isDeleted: false,
					},
				],
			},
		})
	);
}

export async function getAllAPIKeys() {
	const [err, dbConfig] = await asaw(getDBConfigByUser(true));

	if (err) throw err;

	if (!dbConfig?.id) throw "No database config present!";

	const [, data] = await asaw(
		prisma.aPIKeys.findMany({
			where: {
				AND: [
					{
						databaseConfigId: dbConfig?.id,
					},
					{ isDeleted: false },
				],
			},
			select: {
				apiKey: true,
				createdAt: true,
				id: true,
				createdByUser: {
					select: {
						email: true,
					},
				},
			},
			orderBy: {
				createdAt: "desc",
			},
		})
	);
	return data;
}

export async function deleteAPIKey(id: string) {
	return await asaw(
		prisma.aPIKeys.update({ where: { id }, data: { isDeleted: true } })
	);
}
