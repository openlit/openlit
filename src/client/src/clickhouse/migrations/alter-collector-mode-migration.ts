import { COLLECTOR_INSTANCES_TABLE } from "@/lib/platform/collector/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "alter-collector-mode-enum";

export default async function AlterCollectorModeMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${COLLECTOR_INSTANCES_TABLE} MODIFY COLUMN mode Enum8('linux' = 0, 'kubernetes' = 1, 'docker' = 2, 'standalone' = 3) DEFAULT 'linux';`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
