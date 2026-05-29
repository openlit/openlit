import { dataCollector } from "@/lib/platform/common";

export default async function AddControllerClusterIdMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE openlit_controller_services ADD COLUMN IF NOT EXISTS cluster_id String DEFAULT 'default'`,
		`ALTER TABLE openlit_controller_instances ADD COLUMN IF NOT EXISTS cluster_id String DEFAULT 'default'`,
		`ALTER TABLE openlit_controller_actions ADD COLUMN IF NOT EXISTS cluster_id String DEFAULT 'default'`,
	];

	for (const query of queries) {
		await dataCollector({ query }, "query", databaseConfigId);
	}
}
