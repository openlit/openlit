import { Folder } from "@/types/dashlit";
import { dataCollector } from "../common";
import { OPENLIT_FOLDER_TABLE_NAME } from "./table-details";
import Sanitizer from "@/utils/sanitizer";
import getMessage from "@/constants/messages";

export function getFolderById(id: string) {
	const query = `
		SELECT id, title, description, parent_id AS parentId, created_at AS createdAt, updated_at AS updatedAt
		FROM ${OPENLIT_FOLDER_TABLE_NAME} 
		WHERE id = '${Sanitizer.sanitizeValue(id)}'
	`;

	return dataCollector({ query });
}

export function getFolders() {
	const query = `
		SELECT id, title, description, parent_id AS parentId, created_at AS createdAt, updated_at AS updatedAt
		FROM ${OPENLIT_FOLDER_TABLE_NAME} 
	`;

	return dataCollector({ query });
}

export function createFolder(folder: Folder) {
	const sanitizedFolder = Sanitizer.sanitizeObject(folder);

	return dataCollector(
		{
			table: OPENLIT_FOLDER_TABLE_NAME,
			values: [
				{
					title: sanitizedFolder.title,
					description: sanitizedFolder.description,
					parent_id: sanitizedFolder.parentId,
				},
			],
		},
		"insert"
	);
}

export async function updateFolder(folder: Folder) {
	const sanitizedFolder = Sanitizer.sanitizeObject(folder);

	const updateValues = [
		sanitizedFolder.title && `title = '${sanitizedFolder.title}'`,
		sanitizedFolder.description &&
			`description = '${sanitizedFolder.description}'`,
		`parent_id = '${sanitizedFolder.parentId}'`,
	];

	const query = `
		ALTER TABLE ${OPENLIT_FOLDER_TABLE_NAME}
		UPDATE 
			${updateValues.filter((e) => e).join(" , ")}
		WHERE id = '${sanitizedFolder.id}'
	`;

	const { err, data } = await dataCollector({ query }, "exec");

	if (err || !(data as { query_id: string }).query_id)
		return { err: getMessage().FOLDER_UPDATE_FAILED };

	return { data: getMessage().FOLDER_UPDATED_SUCCESSFULLY };
}

export function deleteFolder(id: string) {
	const query = `
		DELETE FROM ${OPENLIT_FOLDER_TABLE_NAME} 
		WHERE id = '${Sanitizer.sanitizeValue(id)}'
	`;

	return dataCollector({ query }, "exec");
}
