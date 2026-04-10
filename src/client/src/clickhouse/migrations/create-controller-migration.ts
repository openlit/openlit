import {
	CONTROLLER_SERVICES_TABLE,
	CONTROLLER_INSTANCES_TABLE,
	CONTROLLER_CONFIG_TABLE,
	CONTROLLER_ACTIONS_TABLE,
} from "@/lib/platform/controller/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-controller-tables";

export default async function CreateControllerMigration(
	databaseConfigId?: string
) {
	const queries = [
		`
		CREATE TABLE IF NOT EXISTS ${CONTROLLER_SERVICES_TABLE} (
			id UUID DEFAULT generateUUIDv4(),
			controller_instance_id String,
			service_name String,
			workload_key String DEFAULT '',
			namespace String DEFAULT '',
			language_runtime String DEFAULT '',
			llm_providers Array(String),
			open_ports Array(UInt16),
			deployment_name String DEFAULT '',
			pid UInt32 DEFAULT 0,
			exe_path String DEFAULT '',
			instrumentation_status Enum8(
				'discovered' = 0,
				'instrumented' = 1
			) DEFAULT 'discovered',
			first_seen DateTime DEFAULT now(),
			last_seen DateTime DEFAULT now(),
			updated_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (controller_instance_id, workload_key);
		`,
		`
		CREATE TABLE IF NOT EXISTS ${CONTROLLER_INSTANCES_TABLE} (
			id UUID DEFAULT generateUUIDv4(),
			instance_id String,
			node_name String DEFAULT '',
			version String DEFAULT '',
			mode Enum8('linux' = 0, 'kubernetes' = 1, 'docker' = 2) DEFAULT 'linux',
			status Enum8('healthy' = 0, 'degraded' = 1, 'error' = 2) DEFAULT 'healthy',
			listen_addr String DEFAULT '',
			external_url String DEFAULT '',
			services_discovered UInt32 DEFAULT 0,
			services_instrumented UInt32 DEFAULT 0,
			last_heartbeat DateTime DEFAULT now(),
			config_hash String DEFAULT '',
			created_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(last_heartbeat)
		ORDER BY (instance_id);
		`,
		`
		CREATE TABLE IF NOT EXISTS ${CONTROLLER_CONFIG_TABLE} (
			instance_id String,
			config String DEFAULT '{}',
			updated_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (instance_id);
		`,
		`
		CREATE TABLE IF NOT EXISTS ${CONTROLLER_ACTIONS_TABLE} (
			id UUID DEFAULT generateUUIDv4(),
			instance_id String,
			action_type Enum8(
				'instrument' = 0,
				'uninstrument' = 1,
				'enable_python_sdk' = 2,
				'disable_python_sdk' = 3
			),
			service_key String DEFAULT '',
			payload String DEFAULT '{}',
			status Enum8('pending' = 0, 'acknowledged' = 1, 'completed' = 2, 'failed' = 3) DEFAULT 'pending',
			result String DEFAULT '',
			created_at DateTime DEFAULT now(),
			updated_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (instance_id, id);
		`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
