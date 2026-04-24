import { dataCollector } from "@/lib/platform/common";

export default async function AddControllerDesiredStateMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE openlit_controller_services ADD COLUMN IF NOT EXISTS desired_instrumentation_status Enum8('none' = 0, 'instrumented' = 1) DEFAULT 'none'`,
		`ALTER TABLE openlit_controller_services ADD COLUMN IF NOT EXISTS desired_agent_status Enum8('none' = 0, 'enabled' = 1) DEFAULT 'none'`,
	];

	for (const query of queries) {
		await dataCollector({ query }, "query", databaseConfigId);
	}
}
