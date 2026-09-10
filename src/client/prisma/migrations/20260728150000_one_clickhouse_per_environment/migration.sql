-- A project environment has exactly one ClickHouse connector.
-- Move duplicate legacy targets to deterministic legacy environments before
-- adding the database-level uniqueness constraint.
CREATE TEMP TABLE "_duplicate_database_environment_map" (
  "database_config_id" TEXT PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "environment" TEXT NOT NULL
);

INSERT INTO "_duplicate_database_environment_map" ("database_config_id", "project_id", "environment")
SELECT ranked."id", ranked."project_id", ranked."environment" || '-legacy-' || ranked."row_number"
FROM (
  SELECT
    "id",
    "project_id",
    "environment",
    ROW_NUMBER() OVER (PARTITION BY "project_id", "environment" ORDER BY "createdAt" ASC, "id" ASC) AS "row_number"
  FROM "databaseconfig"
  WHERE "project_id" IS NOT NULL
) ranked
WHERE ranked."row_number" > 1;

INSERT OR IGNORE INTO "project_environments" ("id", "project_id", "name", "createdAt", "updatedAt")
SELECT 'env_' || lower(hex(randomblob(16))), "project_id", "environment", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_duplicate_database_environment_map";

UPDATE "telemetry_source_binding"
SET "environment" = (
  SELECT map."environment"
  FROM "_duplicate_database_environment_map" map
  WHERE map."database_config_id" = "telemetry_source_binding"."database_config_id"
)
WHERE "database_config_id" IN (SELECT "database_config_id" FROM "_duplicate_database_environment_map");

UPDATE "databaseconfig"
SET "environment" = (
  SELECT map."environment"
  FROM "_duplicate_database_environment_map" map
  WHERE map."database_config_id" = "databaseconfig"."id"
)
WHERE "id" IN (SELECT "database_config_id" FROM "_duplicate_database_environment_map");

DROP TABLE "_duplicate_database_environment_map";

CREATE UNIQUE INDEX "databaseconfig_project_id_environment_key"
ON "databaseconfig"("project_id", "environment");
