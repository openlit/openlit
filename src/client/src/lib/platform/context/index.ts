import getMessage from "@/constants/messages";
import { ContextInput } from "@/types/context";
import { verifyContextInput } from "@/helpers/server/context";
import { getCurrentUser } from "@/lib/session";
import { throwIfError } from "@/utils/error";
import Sanitizer from "@/utils/sanitizer";
import { OPENLIT_CONTEXTS_TABLE_NAME } from "./table-details";
import { dataCollector } from "../common";

export async function getContexts(databaseConfigId?: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const query = `
    SELECT * FROM ${OPENLIT_CONTEXTS_TABLE_NAME}
    ORDER BY created_at DESC;
  `;

	return await dataCollector({ query }, "query", databaseConfigId);
}

export async function getContextById(id: string, databaseConfigId?: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const safeId = Sanitizer.sanitizeValue(id);

	const query = `
    SELECT * FROM ${OPENLIT_CONTEXTS_TABLE_NAME}
    WHERE id = '${safeId}';
  `;

	return await dataCollector({ query }, "query", databaseConfigId);
}

export async function createContext(contextInputParams: Partial<ContextInput>) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const contextInput = Sanitizer.sanitizeObject(contextInputParams);
	const verified = verifyContextInput(contextInput);
	throwIfError(!verified.success, verified.err!);

	const contextId = crypto.randomUUID();

	const { err } = await dataCollector(
		{
			table: OPENLIT_CONTEXTS_TABLE_NAME,
			values: [
				{
					id: contextId,
					name: contextInput.name,
					content: contextInput.content,
					description: contextInput.description || "",
					tags: contextInput.tags || "[]",
					meta_properties: contextInput.meta_properties || "{}",
					status: contextInput.status || "ACTIVE",
					created_by: user!.email,
				},
			],
		},
		"insert"
	);

	throwIfError(
		!!err,
		typeof err?.toString === "function"
			? err.toString()
			: (err as string) || getMessage().CONTEXT_NOT_CREATED
	);

	return { message: getMessage().CONTEXT_CREATED, id: contextId };
}

export async function updateContext(id: string, contextInputParams: Partial<ContextInput>) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const contextInput = Sanitizer.sanitizeObject(contextInputParams);
	const verified = verifyContextInput(contextInput);
	throwIfError(!verified.success, verified.err!);

	const safeId = Sanitizer.sanitizeValue(id);

	const updateValues = [
		`updated_at = now()`,
		contextInput.name && `name = '${contextInput.name}'`,
		contextInput.content && `content = '${contextInput.content}'`,
		contextInput.description !== undefined && `description = '${contextInput.description}'`,
		contextInput.tags !== undefined && `tags = '${contextInput.tags}'`,
		contextInput.meta_properties !== undefined && `meta_properties = '${contextInput.meta_properties}'`,
		contextInput.status && `status = '${contextInput.status}'`,
	];

	const updateQuery = `
    ALTER TABLE ${OPENLIT_CONTEXTS_TABLE_NAME}
    UPDATE ${updateValues.filter(Boolean).join(", ")}
    WHERE id = '${safeId}'`;

	const { err, data } = await dataCollector({ query: updateQuery }, "exec");

	throwIfError(
		!!(err || !(data as { query_id: unknown })?.query_id),
		typeof err?.toString === "function"
			? err.toString()
			: (err as string) || getMessage().CONTEXT_NOT_UPDATED
	);

	return { message: getMessage().CONTEXT_UPDATED };
}

export async function deleteContext(id: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const safeId = Sanitizer.sanitizeValue(id);

	const { err } = await dataCollector(
		{ query: `DELETE FROM ${OPENLIT_CONTEXTS_TABLE_NAME} WHERE id = '${safeId}';` },
		"exec"
	);

	if (err) {
		return [getMessage().CONTEXT_NOT_DELETED];
	}

	return [undefined, getMessage().CONTEXT_DELETED];
}
