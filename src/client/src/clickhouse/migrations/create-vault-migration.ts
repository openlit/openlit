import getMessage from "@/constants/messages";
import { getDBConfigById, getDBConfigByUser } from "@/lib/db-config";
import { dataCollector } from "@/lib/platform/common";
import { OPENLIT_VAULT_TABLE_NAME } from "@/lib/platform/vault/table-details";
import prisma from "@/lib/prisma";
import asaw from "@/utils/asaw";
import { consoleLog } from "@/utils/log";

const MIGRATION_ID = "create-vault-table";

export default async function CreateVaultMigration(databaseConfigId?: string) {
	let err, dbConfig;
	if (databaseConfigId) {
		[err, dbConfig] = await asaw(getDBConfigById({ id: databaseConfigId }));
	} else {
		[err, dbConfig] = await asaw(getDBConfigByUser(true));
	}

	if (err || !dbConfig?.id) throw err || getMessage().DATABASE_CONFIG_NOT_FOUND;

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

	if (migrationExist === 1) {
		return;
	}

	const queries = [
		`
      CREATE TABLE IF NOT EXISTS ${OPENLIT_VAULT_TABLE_NAME} (
        id UUID DEFAULT generateUUIDv4(),  -- Unique ID for each prompt
        key String,                  -- Name of the secret
        value String DEFAULT '',                 -- Value for the secret key
        created_by String,                 -- Who created the prompt
        created_at DateTime DEFAULT now(), -- Timestamp for when the secret was created
        updated_by String,                                   -- Who updated the version
        updated_at DateTime DEFAULT now(),                   -- When the version was updated
        tags String DEFAULT '[]',                              -- Tags for the version
        PRIMARY KEY id,                  -- Unique primary key constraint
      ) ENGINE = MergeTree()
      ORDER BY id;
    `,
	];

	const queriesRun = await Promise.all(
		queries.map(async (query) => {
			const { err } = await dataCollector({ query });
			if (err) {
				console.log(`********* Migration Error : ${MIGRATION_ID} *********`);
				consoleLog(err);
				console.log(`********* Migration Error : ${MIGRATION_ID} *********`);
			}

			return { err };
		})
	);

	if (queriesRun.filter(({ err }) => !err).length === queries.length) {
		await asaw(
			prisma.clickhouseMigrations.create({
				data: {
					databaseConfigId: dbConfig.id,
					clickhouseMigrationId: MIGRATION_ID,
				},
			})
		);
	}
}
