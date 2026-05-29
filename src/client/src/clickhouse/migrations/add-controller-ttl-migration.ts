import {
	CONTROLLER_SERVICES_TABLE,
	CONTROLLER_INSTANCES_TABLE,
	CONTROLLER_ACTIONS_TABLE,
} from "@/lib/platform/controller/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-controller-ttl";

export default async function AddControllerTTLMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CONTROLLER_SERVICES_TABLE} MODIFY TTL last_seen + INTERVAL 7 DAY;`,
		`ALTER TABLE ${CONTROLLER_INSTANCES_TABLE} MODIFY TTL last_heartbeat + INTERVAL 7 DAY;`,
		`ALTER TABLE ${CONTROLLER_ACTIONS_TABLE} MODIFY TTL updated_at + INTERVAL 1 DAY;`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
