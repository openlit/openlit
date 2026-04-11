import {
	CONTROLLER_DESIRED_STATES_TABLE,
	CONTROLLER_SERVICES_TABLE,
} from "@/lib/platform/controller/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-controller-desired-states-table";

export default async function CreateControllerDesiredStatesTableMigration(
	databaseConfigId?: string
) {
	const queries = [
		`
		CREATE TABLE IF NOT EXISTS ${CONTROLLER_DESIRED_STATES_TABLE} (
			workload_key String,
			cluster_id String DEFAULT 'default',
			desired_instrumentation_status Enum8('none' = 0, 'instrumented' = 1) DEFAULT 'none',
			desired_agent_status Enum8('none' = 0, 'enabled' = 1) DEFAULT 'none',
			updated_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (workload_key, cluster_id)
		SETTINGS index_granularity = 8192
		`,
		`
		INSERT INTO ${CONTROLLER_DESIRED_STATES_TABLE}
		SELECT
			workload_key,
			cluster_id,
			argMax(desired_instrumentation_status, updated_at) AS desired_instrumentation_status,
			argMax(desired_agent_status, updated_at) AS desired_agent_status,
			max(updated_at) AS updated_at
		FROM ${CONTROLLER_SERVICES_TABLE}
		FINAL
		WHERE workload_key != ''
		GROUP BY workload_key, cluster_id
		HAVING desired_instrumentation_status != 'none' OR desired_agent_status != 'none'
		`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
