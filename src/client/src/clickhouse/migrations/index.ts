import createPromptTable from "./create-prompt-table";

export default async function migrations(databaseConfigId?: string) {
	await createPromptTable(databaseConfigId);
}
