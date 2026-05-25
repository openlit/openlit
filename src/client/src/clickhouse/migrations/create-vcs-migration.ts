import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-vcs-tables";

/**
 * VCS-side tables for the v2 GitHub App integration.
 *
 * v1 emits coding_agent.vcs.* + standard vcs.* attributes on every span
 * but does NOT yet populate these tables — the dedicated GitHub App
 * webhook + AI-authorship detector ship in v2 and will fill them in.
 *
 * We create the tables now so:
 *   - dashboards can reference them (returning empty until v2)
 *   - operators can roll out the migration ahead of v2 with no downtime
 *   - v2's webhook code can INSERT immediately without a coordinated migration
 *
 * Tables:
 *   - openlit_vcs_commits          — per-commit metadata, AI/human authorship
 *   - openlit_vcs_pull_requests    — per-PR metadata
 *   - openlit_vcs_pr_files         — per-PR file changes
 *   - openlit_vcs_line_attributions — line-level AI vs human authorship
 *   - openlit_vcs_security_findings — security scan results tied to commits
 *
 * Schemas are placeholders; v2 may extend them with additional columns
 * (the standard ALTER ADD COLUMN IF NOT EXISTS pattern keeps it safe).
 */

export const VCS_COMMITS_TABLE = "openlit_vcs_commits";
export const VCS_PULL_REQUESTS_TABLE = "openlit_vcs_pull_requests";
export const VCS_PR_FILES_TABLE = "openlit_vcs_pr_files";
export const VCS_LINE_ATTRIBUTIONS_TABLE = "openlit_vcs_line_attributions";
export const VCS_SECURITY_FINDINGS_TABLE = "openlit_vcs_security_findings";

export default async function CreateVcsMigration(databaseConfigId?: string) {
	const queries = [
		`
		CREATE TABLE IF NOT EXISTS ${VCS_COMMITS_TABLE} (
			organization_id String,
			repo_url String,
			sha String,
			parent_sha String DEFAULT '',
			branch String DEFAULT '',
			author_email String DEFAULT '',
			author_name String DEFAULT '',
			authored_at DateTime DEFAULT now(),
			committed_at DateTime DEFAULT now(),
			ai_authorship_label Enum8('unknown' = 0, 'ai' = 1, 'human' = 2, 'mixed' = 3) DEFAULT 'unknown',
			ai_authorship_confidence Enum8('low' = 0, 'medium' = 1, 'high' = 2) DEFAULT 'low',
			ai_authorship_signal String DEFAULT '',
			coding_agent_session_id String DEFAULT '',
			coding_agent_vendor String DEFAULT '',
			lines_added UInt32 DEFAULT 0,
			lines_removed UInt32 DEFAULT 0,
			files_changed UInt32 DEFAULT 0,
			created_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(created_at)
		ORDER BY (organization_id, repo_url, sha)
		TTL committed_at + INTERVAL 365 DAY DELETE
		SETTINGS index_granularity = 8192;
		`,
		`
		CREATE TABLE IF NOT EXISTS ${VCS_PULL_REQUESTS_TABLE} (
			organization_id String,
			repo_url String,
			number UInt32,
			title String DEFAULT '',
			state Enum8('open' = 0, 'closed' = 1, 'merged' = 2) DEFAULT 'open',
			author_email String DEFAULT '',
			head_sha String DEFAULT '',
			base_sha String DEFAULT '',
			created_at DateTime DEFAULT now(),
			merged_at DateTime DEFAULT '1970-01-01 00:00:00',
			closed_at DateTime DEFAULT '1970-01-01 00:00:00',
			coding_agent_session_id String DEFAULT '',
			coding_agent_vendor String DEFAULT '',
			ai_authorship_label Enum8('unknown' = 0, 'ai' = 1, 'human' = 2, 'mixed' = 3) DEFAULT 'unknown',
			survival_status Enum8('unknown' = 0, 'merged' = 1, 'reverted' = 2, 'reworked' = 3, 'shipped' = 4) DEFAULT 'unknown'
		) ENGINE = ReplacingMergeTree(created_at)
		ORDER BY (organization_id, repo_url, number)
		TTL created_at + INTERVAL 365 DAY DELETE
		SETTINGS index_granularity = 8192;
		`,
		`
		CREATE TABLE IF NOT EXISTS ${VCS_PR_FILES_TABLE} (
			organization_id String,
			repo_url String,
			pr_number UInt32,
			file_path String,
			lines_added UInt32 DEFAULT 0,
			lines_removed UInt32 DEFAULT 0,
			ai_authorship_label Enum8('unknown' = 0, 'ai' = 1, 'human' = 2, 'mixed' = 3) DEFAULT 'unknown',
			created_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(created_at)
		ORDER BY (organization_id, repo_url, pr_number, file_path)
		TTL created_at + INTERVAL 365 DAY DELETE
		SETTINGS index_granularity = 8192;
		`,
		`
		CREATE TABLE IF NOT EXISTS ${VCS_LINE_ATTRIBUTIONS_TABLE} (
			organization_id String,
			repo_url String,
			file_path String,
			commit_sha String,
			line_start UInt32,
			line_end UInt32,
			author Enum8('unknown' = 0, 'ai' = 1, 'human' = 2, 'mixed' = 3) DEFAULT 'unknown',
			confidence Enum8('low' = 0, 'medium' = 1, 'high' = 2) DEFAULT 'low',
			signal String DEFAULT '',
			coding_agent_session_id String DEFAULT '',
			created_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(created_at)
		ORDER BY (organization_id, repo_url, file_path, commit_sha, line_start)
		TTL created_at + INTERVAL 365 DAY DELETE
		SETTINGS index_granularity = 8192;
		`,
		`
		CREATE TABLE IF NOT EXISTS ${VCS_SECURITY_FINDINGS_TABLE} (
			organization_id String,
			repo_url String,
			commit_sha String,
			finding_id String,
			severity Enum8('info' = 0, 'low' = 1, 'medium' = 2, 'high' = 3, 'critical' = 4) DEFAULT 'low',
			rule_id String DEFAULT '',
			file_path String DEFAULT '',
			line_start UInt32 DEFAULT 0,
			line_end UInt32 DEFAULT 0,
			coding_agent_session_id String DEFAULT '',
			coding_agent_vendor String DEFAULT '',
			created_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(created_at)
		ORDER BY (organization_id, repo_url, commit_sha, finding_id)
		TTL created_at + INTERVAL 365 DAY DELETE
		SETTINGS index_granularity = 8192;
		`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
