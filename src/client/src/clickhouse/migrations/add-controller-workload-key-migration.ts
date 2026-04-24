import { CONTROLLER_SERVICES_TABLE } from "@/lib/platform/controller/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-controller-workload-key";

export default async function AddControllerWorkloadKeyMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CONTROLLER_SERVICES_TABLE} ADD COLUMN IF NOT EXISTS workload_key String DEFAULT '';`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
