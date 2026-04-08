import { OPENLIT_VAULT_TABLE_NAME } from "@/lib/platform/vault/table-details";
import { dataCollector } from "@/lib/platform/common";
import { encryptValue, isEncrypted } from "@/utils/crypto";
import { getDBConfigById, getDBConfigByUser } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import prisma from "@/lib/prisma";
import { consoleLog } from "@/utils/log";

const MIGRATION_ID = "encrypt-vault-values";

/**
 * Migration to encrypt existing plaintext vault values.
 * Reads all secrets, encrypts any that aren't already encrypted,
 * and writes them back using ALTER TABLE UPDATE.
 */
export default async function EncryptVaultValuesMigration(
	databaseConfigId?: string
) {
	let err, dbConfig;
	if (databaseConfigId) {
		[err, dbConfig] = await asaw(getDBConfigById({ id: databaseConfigId }));
	} else {
		[err, dbConfig] = await asaw(getDBConfigByUser(true));
	}

	if (err || !dbConfig?.id) return { migrationExist: false, queriesRun: false };

	// Check if migration already ran
	const [, migrationExist] = await asaw(
		prisma.clickhouseMigrations.findFirst({
			where: {
				AND: {
					databaseConfigId: dbConfig.id as string,
					clickhouseMigrationId: MIGRATION_ID,
				},
			},
		})
	);

	if (migrationExist?.id) {
		return { migrationExist: true, queriesRun: false };
	}

	try {
		// Read all secrets with their values
		const { data, err: readErr } = await dataCollector(
			{
				query: `SELECT id, value FROM ${OPENLIT_VAULT_TABLE_NAME}`,
			},
			"query",
			dbConfig.id
		);

		if (readErr || !data || !Array.isArray(data)) {
			consoleLog(
				`Vault encryption migration: no data to migrate or error: ${readErr}`
			);
			// Mark migration as done even if no data (table might be empty)
			await asaw(
				prisma.clickhouseMigrations.create({
					data: {
						databaseConfigId: dbConfig.id,
						clickhouseMigrationId: MIGRATION_ID,
					},
				})
			);
			return { migrationExist: false, queriesRun: true };
		}

		// Filter to only plaintext values that need encryption
		const plaintextSecrets = (data as any[]).filter(
			(secret) => secret.value && !isEncrypted(secret.value)
		);

		if (plaintextSecrets.length === 0) {
			consoleLog("Vault encryption migration: all values already encrypted");
			await asaw(
				prisma.clickhouseMigrations.create({
					data: {
						databaseConfigId: dbConfig.id,
						clickhouseMigrationId: MIGRATION_ID,
					},
				})
			);
			return { migrationExist: false, queriesRun: true };
		}

		// Encrypt each plaintext value and update in ClickHouse
		for (const secret of plaintextSecrets) {
			const encrypted = encryptValue(secret.value);
			// Escape single quotes in the encrypted value for SQL
			const escapedEncrypted = encrypted.replace(/'/g, "\\'");
			const updateQuery = `
				ALTER TABLE ${OPENLIT_VAULT_TABLE_NAME}
				UPDATE value = '${escapedEncrypted}'
				WHERE id = '${secret.id}'
			`;

			const { err: updateErr } = await dataCollector(
				{ query: updateQuery },
				"exec",
				dbConfig.id
			);

			if (updateErr) {
				consoleLog(
					`Vault encryption migration: failed to encrypt secret ${secret.id}: ${updateErr}`
				);
			}
		}

		consoleLog(
			`Vault encryption migration: encrypted ${plaintextSecrets.length} secrets`
		);

		// Mark migration as complete
		await asaw(
			prisma.clickhouseMigrations.create({
				data: {
					databaseConfigId: dbConfig.id,
					clickhouseMigrationId: MIGRATION_ID,
				},
			})
		);

		return { migrationExist: false, queriesRun: true };
	} catch (migrationError) {
		consoleLog(`Vault encryption migration error: ${migrationError}`);
		return { migrationExist: false, queriesRun: false };
	}
}
