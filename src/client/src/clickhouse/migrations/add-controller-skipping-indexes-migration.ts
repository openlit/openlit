import {
	CONTROLLER_SERVICES_TABLE,
	CONTROLLER_ACTIONS_TABLE,
	CONTROLLER_INSTANCES_TABLE,
} from "@/lib/platform/controller/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-controller-skipping-indexes";

export default async function AddControllerSkippingIndexesMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CONTROLLER_SERVICES_TABLE} ADD INDEX IF NOT EXISTS idx_last_seen last_seen TYPE minmax GRANULARITY 4`,
		`ALTER TABLE ${CONTROLLER_ACTIONS_TABLE} ADD INDEX IF NOT EXISTS idx_updated_at updated_at TYPE minmax GRANULARITY 4`,
		`ALTER TABLE ${CONTROLLER_ACTIONS_TABLE} ADD INDEX IF NOT EXISTS idx_status status TYPE set(5) GRANULARITY 4`,
		`ALTER TABLE ${CONTROLLER_INSTANCES_TABLE} ADD INDEX IF NOT EXISTS idx_heartbeat last_heartbeat TYPE minmax GRANULARITY 4`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
