-- Legacy installations stored multiple project databases as production-only.
-- Preserve the oldest database as production and give subsequent legacy
-- targets deterministic environments so the global environment selector can
-- switch the complete ClickHouse-backed feature scope.
CREATE TEMP TABLE "_legacy_database_environment_map" (
  "database_config_id" TEXT PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "environment" TEXT NOT NULL
);

INSERT INTO "_legacy_database_environment_map" ("database_config_id", "project_id", "environment")
SELECT
  ranked."id",
  ranked."project_id",
  CASE ranked."row_number"
    WHEN 1 THEN 'production'
    WHEN 2 THEN 'staging'
    WHEN 3 THEN 'development'
    ELSE 'legacy-' || ranked."row_number"
  END
FROM (
  SELECT
    "id",
    "project_id",
    ROW_NUMBER() OVER (PARTITION BY "project_id" ORDER BY "createdAt" ASC, "id" ASC) AS "row_number",
    COUNT(*) OVER (PARTITION BY "project_id") AS "project_database_count"
  FROM "databaseconfig"
  WHERE "project_id" IS NOT NULL AND "environment" = 'production'
) ranked
WHERE ranked."project_database_count" > 1;

INSERT OR IGNORE INTO "project_environments" ("id", "project_id", "name", "createdAt", "updatedAt")
SELECT 'env_' || lower(hex(randomblob(16))), "project_id", "environment", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_legacy_database_environment_map";

UPDATE "databaseconfig"
SET "environment" = (
  SELECT map."environment"
  FROM "_legacy_database_environment_map" map
  WHERE map."database_config_id" = "databaseconfig"."id"
)
WHERE "id" IN (SELECT "database_config_id" FROM "_legacy_database_environment_map");

WITH signals(signal) AS (VALUES ('traces'), ('logs'), ('metrics'))
INSERT INTO "telemetry_source_binding"
  ("id", "project_id", "signal", "environment", "source_id", "database_config_id", "createdAt", "updatedAt")
SELECT
  'binding_' || lower(hex(randomblob(16))),
  map."project_id",
  signals.signal,
  map."environment",
  NULL,
  map."database_config_id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_legacy_database_environment_map" map
CROSS JOIN signals
WHERE NOT EXISTS (
  SELECT 1 FROM "telemetry_source_binding" binding
  WHERE binding."project_id" = map."project_id"
    AND binding."signal" = signals.signal
    AND binding."environment" = map."environment"
);

DROP TABLE "_legacy_database_environment_map";
