import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-cost-overlay-table";
const COST_OVERLAY_TABLE = "openlit_cost_overlay";

/**
 * Cost overlay for immutable / external telemetry sources.
 *
 * ClickHouse-native telemetry keeps its in-place `ALTER TABLE otel_traces
 * UPDATE SpanAttributes['gen_ai.usage.cost']` backfill (spanMutation=true).
 * External sources (Datadog, Tempo, ...) are read-only, so recomputed costs
 * are stored here in OpenLIT's own app store, keyed by (source_id, span_id),
 * and applied at read time by the normalizer. This lives in the derived/app
 * tier and always stays in OpenLIT's ClickHouse regardless of where raw
 * telemetry is read from.
 */
export default async function CreateCostOverlayMigration(
	databaseConfigId?: string
) {
	const queries = [
		`
		CREATE TABLE IF NOT EXISTS ${COST_OVERLAY_TABLE} (
			source_id String,
			span_id String,
			cost_usd Float64 DEFAULT 0,
			model String DEFAULT '',
			updated_at DateTime DEFAULT now(),
			INDEX span_id_index (span_id) TYPE bloom_filter GRANULARITY 1
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (source_id, span_id)
		`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
