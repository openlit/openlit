import { CONTROLLER_ACTIONS_TABLE } from "@/lib/platform/controller/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "generalize-controller-desired-states-v2";

export default async function GeneralizeControllerDesiredStatesMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CONTROLLER_ACTIONS_TABLE} MODIFY COLUMN action_type LowCardinality(String)`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
