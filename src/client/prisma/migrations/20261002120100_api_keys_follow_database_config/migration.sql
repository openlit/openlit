-- The DatabaseConfig is authoritative for an API key's tenant. Keys created
-- before configs were split per environment (`<env>-legacy-N`) can still carry
-- the old environment; realign them so the stored tuple matches the store the
-- key writes to.
UPDATE "APIKeys"
SET "environment" = COALESCE(
  NULLIF(trim((SELECT "environment" FROM "databaseconfig" WHERE "databaseconfig"."id" = "APIKeys"."database_config_id")), ''),
  'production'
)
WHERE EXISTS (SELECT 1 FROM "databaseconfig" WHERE "databaseconfig"."id" = "APIKeys"."database_config_id");

UPDATE "APIKeys"
SET "project_id" = (
  SELECT "project_id" FROM "databaseconfig" WHERE "databaseconfig"."id" = "APIKeys"."database_config_id"
)
WHERE EXISTS (
  SELECT 1 FROM "databaseconfig"
  WHERE "databaseconfig"."id" = "APIKeys"."database_config_id"
    AND "databaseconfig"."project_id" IS NOT NULL
);

UPDATE "APIKeys"
SET "organisation_id" = (
  SELECT "organisation_id" FROM "projects" WHERE "projects"."id" = "APIKeys"."project_id"
)
WHERE "project_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "projects" WHERE "projects"."id" = "APIKeys"."project_id");

INSERT OR IGNORE INTO "project_environments" ("id", "project_id", "name", "createdAt", "updatedAt")
SELECT 'env_' || lower(hex(randomblob(16))), "project_id", "environment", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "APIKeys"
WHERE "project_id" IS NOT NULL AND trim("environment") <> '';
