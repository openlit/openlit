import {
	CONTROLLER_ACTIONS_TABLE,
	CONTROLLER_INSTANCES_TABLE,
	CONTROLLER_SERVICES_TABLE,
} from "@/lib/platform/controller/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-controller-cluster-id";

export default async function AddControllerClusterIdMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CONTROLLER_SERVICES_TABLE} ADD COLUMN IF NOT EXISTS cluster_id String DEFAULT 'default';`,
		`ALTER TABLE ${CONTROLLER_INSTANCES_TABLE} ADD COLUMN IF NOT EXISTS cluster_id String DEFAULT 'default';`,
		`ALTER TABLE ${CONTROLLER_ACTIONS_TABLE} ADD COLUMN IF NOT EXISTS cluster_id String DEFAULT 'default';`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
