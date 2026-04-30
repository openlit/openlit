import {
	CONTROLLER_INSTANCES_TABLE,
	CONTROLLER_SERVICES_TABLE,
} from "@/lib/platform/controller/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-controller-resource-attrs";

export default async function AddControllerResourceAttrsMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CONTROLLER_INSTANCES_TABLE} ADD COLUMN IF NOT EXISTS resource_attributes Map(String, String) DEFAULT map();`,
		`ALTER TABLE ${CONTROLLER_SERVICES_TABLE} ADD COLUMN IF NOT EXISTS resource_attributes Map(String, String) DEFAULT map();`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
