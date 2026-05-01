import { OPENLIT_VAULT_TABLE_NAME } from "@/lib/platform/vault/table-details";
import { dataCollector } from "@/lib/platform/common";
import { encryptValue, isEncrypted } from "@/utils/crypto";
import { getDBConfigById, getDBConfigByUser } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import prisma from "@/lib/prisma";
import { consoleLog } from "@/utils/log";

const MIGRATION_ID = "encrypt-vault-values";

function escapeClickHouseString(value: string) {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

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
			await markMigrationComplete(dbConfig.id);
			return { migrationExist: false, queriesRun: true };
		}

		const plaintextSecrets = (data as any[]).filter(
			(secret) => secret.value && !isEncrypted(secret.value)
		);

		if (plaintextSecrets.length === 0) {
			consoleLog("Vault encryption migration: all values already encrypted");
			await markMigrationComplete(dbConfig.id);
			return { migrationExist: false, queriesRun: true };
		}

		for (const secret of plaintextSecrets) {
			const encrypted = escapeClickHouseString(encryptValue(secret.value));
			const secretId = escapeClickHouseString(secret.id);
			const updateQuery = `
				ALTER TABLE ${OPENLIT_VAULT_TABLE_NAME}
				UPDATE value = '${encrypted}'
				WHERE id = '${secretId}'
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

		await markMigrationComplete(dbConfig.id);

		return { migrationExist: false, queriesRun: true };
	} catch (migrationError) {
		consoleLog(`Vault encryption migration error: ${migrationError}`);
		return { migrationExist: false, queriesRun: false };
	}
}

async function markMigrationComplete(databaseConfigId: string) {
	await asaw(
		prisma.clickhouseMigrations.create({
			data: {
				databaseConfigId,
				clickhouseMigrationId: MIGRATION_ID,
			},
		})
	);
}
