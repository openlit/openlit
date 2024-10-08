import getMessage from "@/constants/messages";
import { getDBConfigById, getDBConfigByUser } from "@/lib/db-config";
import { dataCollector } from "@/lib/platform/common";
import {
	OPENLIT_PROMPTS_TABLE_NAME,
	OPENLIT_PROMPT_VERSIONS_TABLE_NAME,
	OPENLIT_PROMPT_VERSION_DOWNLOADS_TABLE_NAME,
} from "@/lib/platform/prompt/table-details";
import prisma from "@/lib/prisma";
import asaw from "@/utils/asaw";
import { consoleLog } from "@/utils/log";

const MIGRATION_ID = "create-prompt-table";

export default async function CreatePromptMigration(databaseConfigId?: string) {
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
      CREATE TABLE IF NOT EXISTS ${OPENLIT_PROMPTS_TABLE_NAME} (
          id UUID DEFAULT generateUUIDv4(),  -- Unique ID for each prompt
          name String,                       -- Unique name for the prompt
          created_by String,                 -- Who created the prompt
          created_at DateTime DEFAULT now(), -- Timestamp for when the prompt was created
          PRIMARY KEY id,                  -- Unique primary key constraint
      ) ENGINE = MergeTree()
      ORDER BY id;
    `,
		`
      CREATE TABLE IF NOT EXISTS ${OPENLIT_PROMPT_VERSIONS_TABLE_NAME} (
        version_id UUID DEFAULT generateUUIDv4(),            -- Unique identifier for each version
        prompt_id UUID,                                      -- Foreign key to prompt
        updated_by String,                                   -- Who updated the version
        updated_at DateTime DEFAULT now(),                   -- When the version was updated
        version String,                                      -- Version in '1.0.0' format
        status Enum('PUBLISHED', 'DRAFT'),                   -- DRAFT or PUBLISHED status
        prompt String DEFAULT '',                            -- The actual prompt content
        tags String DEFAULT '[]',                              -- Tags for the version
        meta_properties String DEFAULT '{}',                   -- Meta properties for the version
        INDEX prompt_version_index (prompt_id, version) TYPE minmax GRANULARITY 1 
      ) ENGINE = MergeTree()
      ORDER BY (prompt_id, version_id);
    `,
		`
      CREATE TABLE IF NOT EXISTS ${OPENLIT_PROMPT_VERSION_DOWNLOADS_TABLE_NAME} (
        download_id UUID DEFAULT generateUUIDv4(),          -- Unique ID for each download
        prompt_id UUID,                                     -- Links to the prompts table
        version_id UUID,                                    -- Version id of the prompt
        downloaded_at DateTime DEFAULT now(),               -- Timestamp when the download occurred
        download_source String DEFAULT 'api',               -- Source of the download (e.g., 'python', 'typescript', 'api')
        meta_properties String DEFAULT '{}'                   -- String field with default empty object for additional properties
      ) 
      ENGINE = MergeTree()
      ORDER BY (prompt_id, version_id, downloaded_at);
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
