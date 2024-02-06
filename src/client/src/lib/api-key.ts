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
		prisma.apikey.create({
			data: {
				name: params.name,
				api_key,
			},
		})
	);
}

export async function getAPIKeys() {
	const [, data] = await asaw(prisma.apikey.findMany());
	return normalizeAPIKeys(data);
}

export async function deleteAPIKey(id: number) {
	return await asaw(prisma.apikey.delete({ where: { id } }));
}
