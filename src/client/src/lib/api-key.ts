import crypto from "crypto";
import prisma from "./prisma";
import asaw from "@/utils/asaw";
import { normalizeAPIKeys } from "@/utils/api-key";

type GenerateAPIKeyProps = {
	name: string;
};

export async function generateAPIKey(params: GenerateAPIKeyProps) {
	const api_key = crypto.randomBytes(32).toString("hex");
	return await asaw(
		prisma.doku_apikeys.create({
			data: {
				name: params.name,
				api_key,
			},
		})
	);
}

export async function getAPIKeys() {
	const [, data] = await asaw(prisma.doku_apikeys.findMany());
	return normalizeAPIKeys(data);
}

export async function deleteAPIKey(id: string) {
	return await asaw(prisma.doku_apikeys.delete({ where: { id } }));
}
