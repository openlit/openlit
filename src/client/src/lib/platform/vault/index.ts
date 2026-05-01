import getMessage from "@/constants/messages";
import {
	SecretGetFilters,
	SecretGetFiltersWithApiKey,
	SecretInput,
} from "@/types/vault";
import { normalizeSecretDataForSDK, verifySecretInput } from "@/helpers/server/vault";
import { getCurrentUser } from "@/lib/session";
import { throwIfError } from "@/utils/error";
import Sanitizer from "@/utils/sanitizer";
import { OPENLIT_VAULT_TABLE_NAME } from "./table-details";
import { dataCollector } from "../common";
import { jsonStringify } from "@/utils/json";
import { getAPIKeyInfo } from "../api-keys";
import { decryptValue, encryptValue } from "@/utils/crypto";

function escapeClickHouseString(value: string) {
	return value.replace(/'/g, "\\'");
}

function getOwnerEmailCondition(user: { email?: string | null }, alias?: string) {
	const column = alias ? `${alias}.created_by` : "created_by";
	return `${column} = '${escapeClickHouseString(user.email || "")}'`;
}

function decryptSecrets<T extends Record<string, any>>(secrets: T[]): T[] {
	return secrets.map((secret) => ({
		...secret,
		value:
			typeof secret.value === "string"
				? decryptValue(secret.value)
				: secret.value,
	}));
}

export async function getSecretByName({
	key,
	createdBy,
}: {
	key: string;
	createdBy?: string;
}) {
	const conditions = [
		`key='${escapeClickHouseString(Sanitizer.sanitizeValue(key))}'`,
		createdBy
			? `created_by = '${escapeClickHouseString(Sanitizer.sanitizeValue(createdBy))}'`
			: "",
	].filter(Boolean);

	const query = `
			SELECT * FROM ${OPENLIT_VAULT_TABLE_NAME} WHERE ${conditions.join(" AND ")};
	  `;

	const { data }: { data?: any } = await dataCollector({ query });
	return data?.[0];
}

export async function checkNameValidity({
	key,
	createdBy,
}: {
	key: string;
	createdBy?: string;
}) {
	const data = await getSecretByName({ key, createdBy });
	return { isValid: !data?.id };
}

export async function upsertSecret(secretInputParams: Partial<SecretInput>) {
	const user = await getCurrentUser();

	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const secretInput = Sanitizer.sanitizeObject(secretInputParams);

	const verifiedSecretObj = verifySecretInput(secretInput);
	throwIfError(!verifiedSecretObj.success, verifiedSecretObj.err!);

	const encryptedValue = secretInput.value
		? escapeClickHouseString(encryptValue(secretInput.value))
		: undefined;
	const ownerCondition = getOwnerEmailCondition(user!);
	const ownerEmail = escapeClickHouseString(user!.email || "");

	if (!secretInputParams.id) {
		const { isValid } = await checkNameValidity({
			key: secretInput.key || "",
			createdBy: user!.email || "",
		});
		throwIfError(!isValid, getMessage().SECRET_NAME_TAKEN);
	}

	if (secretInputParams.id) {
		const secretId = escapeClickHouseString(
			Sanitizer.sanitizeValue(secretInput.id || "")
		);
		const updateValues = [
			`updated_by = '${ownerEmail}'`,
			secretInput.key &&
				"key = '" +
					escapeClickHouseString(Sanitizer.sanitizeValue(secretInput.key)) +
					"'",
			encryptedValue && "value = '" + encryptedValue + "'",
			secretInput.tags &&
				"tags = '" +
					escapeClickHouseString(jsonStringify(secretInput.tags)) +
					"'",
		];
		const updateQuery = `
	      ALTER TABLE ${OPENLIT_VAULT_TABLE_NAME}
	      UPDATE 
	        ${updateValues.filter((e) => e).join(" , ")}
	      WHERE id = '${secretId}' AND ${ownerCondition}`;
		const { err, data } = await dataCollector(
			{
				query: updateQuery,
			},
			"exec"
		);
		throwIfError(
			!!(err || !(data as { query_id: unknown })?.query_id),
			typeof err?.toString === "function"
				? err.toString()
				: (err as string) || getMessage().SECRET_NOT_SAVED
		);

		return getMessage().SECRET_SAVED;
	} else {
		const { err } = await dataCollector(
			{
				table: OPENLIT_VAULT_TABLE_NAME,
				values: [
					{
						key: secretInput.key,
						value: encryptedValue || "",
						tags: secretInput.tags,
						created_by: user!.email,
					},
				],
			},
			"insert"
		);

		throwIfError(
			!!err,
			typeof err?.toString === "function" ? err.toString() : (err as string)
		);
	}

	return {
		data: {},
		message: getMessage().SECRET_SAVED,
	};
}

export async function deleteSecret(secretIdParam: string) {
	const user = await getCurrentUser();

	throwIfError(!user, getMessage().UNAUTHORIZED_USER);
	const secretId = Sanitizer.sanitizeValue(secretIdParam);
	const ownerCondition = getOwnerEmailCondition(user!);

	const { err } = await dataCollector(
		{
			query: `DELETE FROM ${OPENLIT_VAULT_TABLE_NAME} WHERE id = '${escapeClickHouseString(secretId)}' AND ${ownerCondition};`,
		},
		"exec"
	);

	if (err) {
		return [getMessage().SECRET_NOT_DELETED];
	}

	return [undefined, getMessage().SECRET_DELETED];
}

export async function getSecrets(
	filters: SecretGetFilters,
	{ selectValue }: { selectValue?: boolean } = {}
) {
	let user: Awaited<ReturnType<typeof getCurrentUser>> | null = null;
	if (!filters.databaseConfigId) {
		user = await getCurrentUser();
		throwIfError(!user, getMessage().UNAUTHORIZED_USER);
	}

	const filteredConditions: string[] = [
		user ? getOwnerEmailCondition(user, "v") : "",
		filters.key
			? "v.key = '" +
				escapeClickHouseString(Sanitizer.sanitizeValue(filters.key)) +
				"'"
			: "",
		filters.tags && filters.tags.length > 0
			? `hasAny(JSONExtractArrayRaw(v.tags), ['"` +
			  filters.tags
					.map((tag) => escapeClickHouseString(Sanitizer.sanitizeValue(tag)))
					.join(`"' , '"`) +
			  `"'])`
			: "",
	].filter((e) => !!e);

	const query = `SELECT * ${!!selectValue ? "" : "EXCEPT value"}
		FROM
			${OPENLIT_VAULT_TABLE_NAME} v
		${
			filteredConditions.length > 0
				? `WHERE ${filteredConditions.join(" AND ")}`
				: ""
		} 
		ORDER BY
			v.created_at DESC;
	`;

	const result = await dataCollector({ query }, "query", filters.databaseConfigId);

	if (selectValue && result.data && Array.isArray(result.data)) {
		return {
			...result,
			data: decryptSecrets(result.data as any[]),
		};
	}

	return result;
}

export async function getSecretsFromDatabaseId(
	filters: SecretGetFiltersWithApiKey
) {
	const [err, apiInfo] = await getAPIKeyInfo({
		apiKey: filters.apiKey,
	});

	throwIfError(
		!!(err || !apiInfo?.databaseConfigId),
		err || getMessage().NO_API_KEY
	);

	const { err: secretErr, data: secretData } = await getSecrets(
		{
			...filters,
			databaseConfigId: apiInfo.databaseConfigId,
		},
		{ selectValue: true }
	);

	throwIfError(
		!!(secretErr || !secretData),
		(secretErr as any) || getMessage().NO_PROMPT
	);

	return normalizeSecretDataForSDK(secretData as any[]);
}

export async function getSecretById(
	id: string,
	databaseConfigId?: string,
	excludeVaultValue: boolean = true
) {
	const query = `SELECT * ${
		!!excludeVaultValue ? "EXCEPT value" : ""
	} FROM ${OPENLIT_VAULT_TABLE_NAME} v WHERE v.id = '${id}';`;

	const result = await dataCollector({ query }, "query", databaseConfigId);

	if (!excludeVaultValue && result.data && Array.isArray(result.data)) {
		return {
			...result,
			data: decryptSecrets(result.data as any[]),
		};
	}

	return result;
}
