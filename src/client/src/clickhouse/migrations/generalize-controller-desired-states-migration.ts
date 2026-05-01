import {
	CONTROLLER_ACTIONS_TABLE,
	CONTROLLER_DESIRED_STATES_V2_TABLE,
	CONTROLLER_ENV_CONFIGS_TABLE,
} from "@/lib/platform/controller/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "generalize-controller-desired-states-v2";

export default async function GeneralizeControllerDesiredStatesMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CONTROLLER_ACTIONS_TABLE} MODIFY COLUMN action_type LowCardinality(String)`,

		`
		CREATE TABLE IF NOT EXISTS ${CONTROLLER_DESIRED_STATES_V2_TABLE} (
			workload_key String,
			cluster_id String DEFAULT 'default',
			feature LowCardinality(String),
			desired_status LowCardinality(String) DEFAULT 'none',
			config String DEFAULT '{}',
			updated_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (workload_key, cluster_id, feature)
		SETTINGS index_granularity = 8192
		`,

		`
		INSERT INTO ${CONTROLLER_DESIRED_STATES_V2_TABLE}
			(workload_key, cluster_id, feature, desired_status, config, updated_at)
		SELECT
			workload_key,
			cluster_id,
			'instrumentation' AS feature,
			argMax(desired_instrumentation_status, updated_at) AS desired_status,
			'{}' AS config,
			max(updated_at) AS updated_at
		FROM openlit_controller_desired_states
		FINAL
		WHERE workload_key != ''
		GROUP BY workload_key, cluster_id
		HAVING desired_status != 'none'
		`,

		`
		INSERT INTO ${CONTROLLER_DESIRED_STATES_V2_TABLE}
			(workload_key, cluster_id, feature, desired_status, config, updated_at)
		SELECT
			workload_key,
			cluster_id,
			'agent' AS feature,
			argMax(desired_agent_status, updated_at) AS desired_status,
			'{}' AS config,
			max(updated_at) AS updated_at
		FROM openlit_controller_desired_states
		FINAL
		WHERE workload_key != ''
		GROUP BY workload_key, cluster_id
		HAVING desired_status != 'none'
		`,

		`
		CREATE TABLE IF NOT EXISTS ${CONTROLLER_ENV_CONFIGS_TABLE} (
			environment String DEFAULT 'default',
			cluster_id String DEFAULT 'default',
			feature LowCardinality(String),
			config String DEFAULT '{}',
			updated_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (environment, cluster_id, feature)
		SETTINGS index_granularity = 8192
		`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
