import { CUSTOM_EVALUATION_CONFIGS_TABLE_NAME } from "@/lib/platform/evaluation/custom-configs-table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-custom-evaluation-configs-table-1";

export default async function CreateCustomEvaluationConfigsMigration(
  databaseConfigId?: string
) {
  const queries = [
    `
      CREATE TABLE IF NOT EXISTS ${CUSTOM_EVALUATION_CONFIGS_TABLE_NAME} (
          id String,
          database_config_id String,
          name String,
          description String,
          custom_prompt String CODEC(ZSTD),
          evaluation_type String,
          threshold_score Float64,
          enabled UInt8 DEFAULT 1,
          created_by String,
          created_at DateTime DEFAULT now(),
          updated_at DateTime DEFAULT now(),
          meta String DEFAULT '{}'
      ) ENGINE = MergeTree()
      ORDER BY (database_config_id, evaluation_type, created_at)
      TTL updated_at + INTERVAL 2 YEAR DELETE
      SETTINGS index_granularity = 8192;
    `,
  ];

  return migrationHelper({
    clickhouseMigrationId: MIGRATION_ID,
    databaseConfigId,
    queries,
  });
}
