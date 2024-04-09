import { validateConnectionRequest } from "@/helpers/connection";
import { CONNECTION_TABLE_NAME, dataCollector } from "./common";

export async function getConnection() {
	return await dataCollector({
		query: `SELECT * from ${CONNECTION_TABLE_NAME}`,
	});
}

export async function createConnection(values: any) {
	const { err: deleteErr } = await dataCollector(
		{
			query: `DELETE from ${CONNECTION_TABLE_NAME} WHERE 1=1`,
		},
		"command"
	);

	if (deleteErr) {
		return { err: deleteErr };
	}

	const { success, err: validationErr } = validateConnectionRequest(values);
	if (!success) return { err: validationErr };

	const { err } = await dataCollector(
		{
			table: CONNECTION_TABLE_NAME,
			values: [values],
			format: "JSONEachRow",
		},
		"insert"
	);

	if (err) {
		return { err };
	}

	return await getConnection();
}

export async function deleteConnection(id: string) {
	return dataCollector(
		{
			query: `DELETE FROM ${CONNECTION_TABLE_NAME} WHERE id = '${id}'`,
		},
		"command"
	);
}
