-- AlterTable
ALTER TABLE "APIKeys" ADD COLUMN "organisation_id" TEXT;
ALTER TABLE "APIKeys" ADD COLUMN "project_id" TEXT;
ALTER TABLE "APIKeys" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'production';

-- Backfill project + environment from the bound database config.
UPDATE "APIKeys"
SET "project_id" = (
  SELECT "project_id" FROM "databaseconfig" WHERE "databaseconfig"."id" = "APIKeys"."database_config_id"
)
WHERE "project_id" IS NULL;

UPDATE "APIKeys"
SET "environment" = COALESCE(
  NULLIF(trim((SELECT "environment" FROM "databaseconfig" WHERE "databaseconfig"."id" = "APIKeys"."database_config_id")), ''),
  'production'
);

-- Attach orphaned keys to the oldest default project when one exists.
UPDATE "APIKeys"
SET "project_id" = (
  SELECT "id" FROM "projects" WHERE "is_default" = 1 ORDER BY "createdAt" ASC, "id" ASC LIMIT 1
)
WHERE "project_id" IS NULL
  AND EXISTS (SELECT 1 FROM "projects" WHERE "is_default" = 1);

UPDATE "APIKeys"
SET "organisation_id" = (
  SELECT "organisation_id" FROM "projects" WHERE "projects"."id" = "APIKeys"."project_id"
)
WHERE "organisation_id" IS NULL AND "project_id" IS NOT NULL;

-- Ensure the bound project has an environment row for the key.
INSERT OR IGNORE INTO "project_environments" ("id", "project_id", "name", "createdAt", "updatedAt")
SELECT 'env_' || lower(hex(randomblob(16))), "project_id", "environment", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "APIKeys"
WHERE "project_id" IS NOT NULL AND trim("environment") <> '';

CREATE INDEX IF NOT EXISTS "APIKeys_organisation_id_idx" ON "APIKeys"("organisation_id");
CREATE INDEX IF NOT EXISTS "APIKeys_project_id_environment_idx" ON "APIKeys"("project_id", "environment");
