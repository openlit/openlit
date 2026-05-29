import { CONTROLLER_ACTIONS_TABLE } from "@/lib/platform/controller/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "update-controller-actions-ttl-7d";

export default async function UpdateControllerActionsTTLMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CONTROLLER_ACTIONS_TABLE} MODIFY TTL updated_at + INTERVAL 7 DAY;`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
