import { OPENLIT_EVALUATION_TYPE_DEFAULTS_TABLE_NAME } from "@/lib/platform/evaluation/table-details";
import { EVALUATION_TYPE_CONTEXTS } from "@/constants/evaluation-type-contexts";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-evaluation-type-defaults-table-4";

// Derive migration values from the single source of truth (evaluation-type-contexts.ts)
const DEFAULT_PROMPTS: Array<[string, string]> = Object.entries(
	EVALUATION_TYPE_CONTEXTS
).map(([id, { content }]) => [id, content]);

export default async function CreateEvaluationTypeDefaultsMigration(
	databaseConfigId?: string
) {
	const createQuery = `
    CREATE TABLE IF NOT EXISTS ${OPENLIT_EVALUATION_TYPE_DEFAULTS_TABLE_NAME} (
      id String,
      default_prompt String
    ) ENGINE = MergeTree() ORDER BY id;
  `;

	const values = DEFAULT_PROMPTS.map(([id, prompt]) => ({
		id,
		default_prompt: prompt,
	}));

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries: [
			createQuery,
			{ type: "insert", table: OPENLIT_EVALUATION_TYPE_DEFAULTS_TABLE_NAME, values },
		],
	});
}
