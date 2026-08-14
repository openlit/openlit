import { AGENTS_SUMMARY_TABLE } from "@/lib/platform/agents/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-coding-agent-summary-fields";

/**
 * Extends openlit_agents_summary so AI-coding-agent rows (Claude Code,
 * Cursor, Codex) can co-exist with the existing controller/sdk
 * rows on the /agents page:
 *
 *   1. ALTER source enum to include 'coding'.
 *   2. ADD coding_agent_vendor       — pinned vendor identifier.
 *   3. ADD coding_session_count_24h  — 24h rollup populated by materializer.
 *   4. ADD coding_cost_usd_24h       — 24h $ rollup.
 *   5. ADD coding_active_users_24h   — 24h distinct users (k=5 floor on
 *                                      per-user breakdowns enforced
 *                                      server-side at read time).
 *
 * Idempotent — IF NOT EXISTS guards every ADD, and the source enum
 * MODIFY is a no-op when the value already exists.
 */
export default async function AddCodingAgentSummaryFieldsMigration(
	databaseConfigId?: string
) {
	const queries = [
		// Add 'coding' as enum value 3. Existing values (0/1/2) keep
		// their numeric ids so SELECT-WHERE clauses written before the
		// migration ran continue to match. ClickHouse only allows enum
		// extensions when the new value is appended.
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		MODIFY COLUMN source Enum8(
			'controller' = 0,
			'sdk' = 1,
			'both' = 2,
			'coding' = 3
		) DEFAULT 'sdk'
		`,
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_agent_vendor String DEFAULT ''
		`,
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_session_count_24h UInt64 DEFAULT 0
		`,
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_cost_usd_24h Float64 DEFAULT 0
		`,
		`
		ALTER TABLE ${AGENTS_SUMMARY_TABLE}
		ADD COLUMN IF NOT EXISTS coding_active_users_24h UInt32 DEFAULT 0
		`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
