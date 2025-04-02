import { Folder } from "@/types/dashlit";
import { dataCollector } from "../common";
import { OPENLIT_FOLDER_TABLE_NAME } from "./table-details";

export function getFolderById(id: string) {
	const query = `
		SELECT
			*
		FROM ${OPENLIT_FOLDER_TABLE_NAME} 
		WHERE   
			id = '${id}'
	`;

	return dataCollector({ query });
}

export function getFolders() {
	const query = `
		SELECT
			*
		FROM ${OPENLIT_FOLDER_TABLE_NAME} 
	`;

	return dataCollector({ query });
}

export function createFolder(folder: Folder) {
	const query = `
		INSERT INTO ${OPENLIT_FOLDER_TABLE_NAME} (name)
		VALUES (${folder.name})
	`;

	return dataCollector({ query });
}

export function updateFolder(folder: Folder) {
	const query = `
		UPDATE ${OPENLIT_FOLDER_TABLE_NAME} 
		SET title = ${folder.name}
		WHERE id = ${folder.id}
	`;

	return dataCollector({ query });
}

export function deleteFolder(id: string) {
	const query = `
		DELETE FROM ${OPENLIT_FOLDER_TABLE_NAME} 
		WHERE id = ${id}
	`;

	return dataCollector({ query });
}
