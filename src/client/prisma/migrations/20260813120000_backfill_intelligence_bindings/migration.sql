-- Backfill missing `intelligence` signal bindings for every project environment.
-- Prior backfill only seeded traces/logs/metrics; intelligence fail-closes when
-- an explicit environment is requested without a binding (Rule Engine, NL chat,
-- coding-agent ClickHouse fallback).
WITH signals(signal) AS (VALUES ('intelligence'))
INSERT INTO "telemetry_source_binding"
  ("id", "project_id", "signal", "environment", "source_id", "database_config_id", "createdAt", "updatedAt")
SELECT
  'binding_' || lower(hex(randomblob(16))),
  db."project_id",
  signals.signal,
  db."environment",
  NULL,
  db."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "databaseconfig" db
CROSS JOIN signals
WHERE db."project_id" IS NOT NULL
  AND db."id" = (
    SELECT candidate."id"
    FROM "databaseconfig" candidate
    WHERE candidate."project_id" = db."project_id"
      AND candidate."environment" = db."environment"
    ORDER BY candidate."createdAt" ASC, candidate."id" ASC
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "telemetry_source_binding" binding
    WHERE binding."project_id" = db."project_id"
      AND binding."signal" = signals.signal
      AND binding."environment" = db."environment"
  );
