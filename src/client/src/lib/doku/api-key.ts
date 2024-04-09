import crypto from "crypto";
import { normalizeAPIKeys } from "@/helpers/api-key";
import {
	API_KEY_TABLE_NAME,
	RESTRICTED_API_KEY_DELETION_NAMES,
	dataCollector,
} from "./common";

type GenerateAPIKeyProps = {
	name: string;
};

export async function generateAPIKey(params: GenerateAPIKeyProps) {
	const api_key = crypto.randomBytes(32).toString("hex");
	const { err } = await dataCollector(
		{
			table: API_KEY_TABLE_NAME,
			values: [{ name: params.name, api_key }],
			columns: ["name", "api_key"],
			format: "JSONEachRow",
		},
		"insert"
	);

	if (err) {
		return { err };
	}

	return dataCollector({
		query: `SELECT * from ${API_KEY_TABLE_NAME} WHERE name='${params.name}'`,
	});
}

export async function getAPIKeys() {
	const { data = [] as any } = await dataCollector({
		query: `SELECT * from ${API_KEY_TABLE_NAME} WHERE name NOT IN ('${RESTRICTED_API_KEY_DELETION_NAMES.join(
			"' , '"
		)}') ORDER BY created_at asc`,
	});
	return normalizeAPIKeys(data);
}

export async function deleteAPIKey(id: string) {
	return dataCollector(
		{
			query: `DELETE FROM ${API_KEY_TABLE_NAME} WHERE id = '${id}' and name NOT IN ('${RESTRICTED_API_KEY_DELETION_NAMES.join(
				"' , '"
			)}');`,
		},
		"command"
	);
}
