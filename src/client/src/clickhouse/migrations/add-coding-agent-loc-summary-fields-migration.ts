import { AGENTS_SUMMARY_TABLE } from "@/lib/platform/agents/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-coding-agent-loc-summary-fields";

/**
 * Extends openlit_agents_summary with the 24h code-change rollups
 * dashboards now expect for every coding-agent row (Claude Code,
 * Cursor, Codex). These are populated by the materializer cron
 * (src/lib/platform/agents/materialize.ts) from `otel_traces`
 * coding_agent.session.* attributes.
 *
 *   coding_lines_added_24h     — sum of session.lines.added
 *   coding_lines_removed_24h   — sum of session.lines.removed
 *   coding_lines_accepted_24h  — sum of session.lines.accepted
 *   coding_lines_rejected_24h  — sum of session.lines.rejected
 *   coding_edit_accept_24h     — sum of session.edit.accept_count
 *   coding_edit_reject_24h     — sum of session.edit.reject_count
 *   coding_commit_count_24h    — sum of session.commit_count
 *   coding_pr_count_24h        — sum of session.pr_count
 *
 * Idempotent — IF NOT EXISTS guards every ADD.
 */
export default async function AddCodingAgentLOCSummaryFieldsMigration(
	databaseConfigId?: string
) {
	const queries = [
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_lines_added_24h UInt64 DEFAULT 0
		`,
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_lines_removed_24h UInt64 DEFAULT 0
		`,
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_lines_accepted_24h UInt64 DEFAULT 0
		`,
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_lines_rejected_24h UInt64 DEFAULT 0
		`,
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_edit_accept_24h UInt64 DEFAULT 0
		`,
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_edit_reject_24h UInt64 DEFAULT 0
		`,
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_commit_count_24h UInt64 DEFAULT 0
		`,
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_pr_count_24h UInt64 DEFAULT 0
		`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
