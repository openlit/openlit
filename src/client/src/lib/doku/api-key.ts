import crypto from "crypto";
import asaw from "@/utils/asaw";
import { normalizeAPIKeys } from "@/utils/api-key";
import { API_KEY_TABLE_NAME, dataCollector } from "./common";

type GenerateAPIKeyProps = {
	name: string;
};

export async function generateAPIKey(params: GenerateAPIKeyProps) {
	const api_key = crypto.randomBytes(32).toString("hex");
	return dataCollector(`INSERT INTO ${API_KEY_TABLE_NAME} (name, api_key)
	VALUES ("${params.name}", "${api_key}");`);
}

export async function getAPIKeys() {
	const [, { data }] = await asaw(
		dataCollector(`SELECT * from ${API_KEY_TABLE_NAME}`)
	);
	return normalizeAPIKeys(data);
}

export async function deleteAPIKey(id: string) {
	const [, { data }] = await asaw(
		dataCollector(`DELETE FROM ${API_KEY_TABLE_NAME} WHERE id = ${id};`)
	);
	return data;
}
