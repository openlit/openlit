import migrationHelper from "./migration-helper";

const MIGRATION_ID = "drop-vcs-tables";

/**
 * Drops the v2 GitHub-App VCS tables that earlier deployments created
 * via the now-removed `create-vcs-migration`. These tables were never
 * written to (the install / setup / webhook handlers shipped as 501
 * stubs and were removed alongside this migration), so this cleanup is
 * safe and irreversible-without-data-loss only in the sense that there
 * was never any data.
 *
 * `DROP TABLE IF EXISTS` keeps fresh installs that never had the
 * tables a no-op.
 */
export default async function DropVcsMigration(databaseConfigId?: string) {
	const queries = [
		`DROP TABLE IF EXISTS openlit_vcs_commits`,
		`DROP TABLE IF EXISTS openlit_vcs_pull_requests`,
		`DROP TABLE IF EXISTS openlit_vcs_pr_files`,
		`DROP TABLE IF EXISTS openlit_vcs_line_attributions`,
		`DROP TABLE IF EXISTS openlit_vcs_security_findings`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
