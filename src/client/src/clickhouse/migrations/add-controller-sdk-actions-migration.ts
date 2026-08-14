import { CONTROLLER_ACTIONS_TABLE } from "@/lib/platform/controller/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-controller-sdk-actions";

export default async function AddControllerSDKActionsMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CONTROLLER_ACTIONS_TABLE} MODIFY COLUMN action_type Enum8('instrument' = 0, 'uninstrument' = 1, 'enable_python_sdk' = 2, 'disable_python_sdk' = 3);`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
