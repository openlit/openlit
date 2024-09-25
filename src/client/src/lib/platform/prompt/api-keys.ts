import crypto from "crypto";
import { getDBConfigByUser } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import prisma from "@/lib/prisma";

const APIKEY_PREFIX = "openlit-";

export async function generateOrReturnAPIKey() {
	const [err, dbConfig] = await asaw(getDBConfigByUser(true));

	if (err) throw err;

	if (!dbConfig?.id) throw "No database config present!";

	const [, apiKeyObject] = await getAPIKeyInfo({
		databaseConfigId: dbConfig.id,
	});

	if (apiKeyObject?.apiKey) return apiKeyObject;

	// Generate 32 random bytes
	const key = crypto.randomBytes(32);

	// Convert the byte array to a Base64 string
	const apiKey = `${APIKEY_PREFIX}${key.toString("base64")}`;

	await prisma.promptAPIKeys.create({
		data: {
			apiKey,
			databaseConfigId: dbConfig.id,
		},
	});

	return {
		apiKey,
		databaseConfigId: dbConfig.id,
	};
}

export async function getAPIKeyInfo({
	apiKey,
	databaseConfigId,
}: {
	apiKey?: string;
	databaseConfigId?: string;
}) {
	return await asaw(
		prisma.promptAPIKeys.findUnique({
			where: {
				apiKey,
				databaseConfigId,
			},
		})
	);
}
