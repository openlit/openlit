import {
	OPENLIT_RULES_TABLE_NAME,
	OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME,
	OPENLIT_RULE_CONDITIONS_TABLE_NAME,
	OPENLIT_RULE_ENTITIES_TABLE_NAME,
} from "@/lib/platform/rule-engine/table-details";
import { OPENLIT_CONTEXTS_TABLE_NAME } from "@/lib/platform/context/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-rule-engine-table";

export default async function CreateRuleEngineMigration(databaseConfigId?: string) {
	const queries = [
		`
      CREATE TABLE IF NOT EXISTS ${OPENLIT_RULES_TABLE_NAME} (
        id UUID DEFAULT generateUUIDv4(),
        name String,
        description String DEFAULT '',
        group_operator String DEFAULT 'AND',
        status String DEFAULT 'ACTIVE',
        created_by String,
        created_at DateTime DEFAULT now(),
        updated_at DateTime DEFAULT now(),
        PRIMARY KEY id
      ) ENGINE = MergeTree() ORDER BY (id, created_at);
    `,
		`
      CREATE TABLE IF NOT EXISTS ${OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME} (
        id UUID DEFAULT generateUUIDv4(),
        rule_id UUID,
        condition_operator String DEFAULT 'AND',
        created_at DateTime DEFAULT now(),
        PRIMARY KEY id
      ) ENGINE = MergeTree() ORDER BY (id, rule_id, created_at);
    `,
		`
      CREATE TABLE IF NOT EXISTS ${OPENLIT_RULE_CONDITIONS_TABLE_NAME} (
        id UUID DEFAULT generateUUIDv4(),
        rule_id UUID,
        group_id UUID,
        field String,
        operator String,
        value String,
        data_type String DEFAULT 'string',
        created_at DateTime DEFAULT now(),
        PRIMARY KEY id
      ) ENGINE = MergeTree() ORDER BY (id, rule_id, group_id);
    `,
		`
      CREATE TABLE IF NOT EXISTS ${OPENLIT_RULE_ENTITIES_TABLE_NAME} (
        id UUID DEFAULT generateUUIDv4(),
        rule_id UUID,
        entity_type LowCardinality(String),
        entity_id String,
        created_by String,
        created_at DateTime DEFAULT now(),
        PRIMARY KEY id
      ) ENGINE = MergeTree() ORDER BY (id, rule_id, entity_type);
    `,
		`
      CREATE TABLE IF NOT EXISTS ${OPENLIT_CONTEXTS_TABLE_NAME} (
        id UUID DEFAULT generateUUIDv4(),
        name String,
        content String,
        description String DEFAULT '',
        tags String DEFAULT '[]',
        meta_properties String DEFAULT '{}',
        status String DEFAULT 'ACTIVE',
        created_by String,
        created_at DateTime DEFAULT now(),
        updated_at DateTime DEFAULT now(),
        PRIMARY KEY id
      ) ENGINE = MergeTree() ORDER BY (id, created_at);
    `,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
