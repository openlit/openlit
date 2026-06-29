import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-coding-agents-audit";

/**
 * Persistent audit + dispute log for coding-agent governance actions.
 *
 * Two tables:
 *   - openlit_coding_agent_audit_log     append-only event log
 *   - openlit_coding_agent_disputes      one row per dispute submission
 *
 * Audit log captures every governance-grade action (classification
 * dispute, policy edit). It's kept separate from the dispute table so
 * we can query "who did what when" without paginating through the
 * larger trace data.
 *
 * organization_id is stamped from the API route (pulled from the
 * caller's current org via Prisma) — not from a span attribute — so
 * disputes survive even if the underlying trace is later deleted via
 * TTL.
 */

export const CODING_AGENT_AUDIT_LOG_TABLE = "openlit_coding_agent_audit_log";
export const CODING_AGENT_DISPUTES_TABLE = "openlit_coding_agent_disputes";

export default async function CreateCodingAgentsAuditMigration(databaseConfigId?: string) {
	const queries = [
		`
		CREATE TABLE IF NOT EXISTS ${CODING_AGENT_AUDIT_LOG_TABLE} (
			id UUID DEFAULT generateUUIDv4(),
			organization_id String,
			user_id String,
			action String,
			subject String DEFAULT '',
			payload String DEFAULT '',
			created_at DateTime DEFAULT now()
		) ENGINE = MergeTree()
		PARTITION BY toYYYYMM(created_at)
		ORDER BY (organization_id, created_at, id)
		TTL created_at + INTERVAL 365 DAY DELETE
		SETTINGS index_granularity = 8192;
		`,
		`
		CREATE TABLE IF NOT EXISTS ${CODING_AGENT_DISPUTES_TABLE} (
			id UUID DEFAULT generateUUIDv4(),
			organization_id String,
			session_id String,
			user_id String,
			current_classification String,
			requested_classification String,
			rationale String,
			status Enum8('open' = 0, 'accepted' = 1, 'rejected' = 2, 'withdrawn' = 3) DEFAULT 'open',
			resolved_by_user_id String DEFAULT '',
			resolved_at DateTime DEFAULT '1970-01-01 00:00:00',
			created_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(created_at)
		ORDER BY (organization_id, session_id, id)
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
