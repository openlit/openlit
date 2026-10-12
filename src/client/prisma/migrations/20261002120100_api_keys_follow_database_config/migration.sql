-- The DatabaseConfig is authoritative for an API key's tenant. Keys created
-- before configs were split per environment (`<env>-legacy-N`) can still carry
-- the old environment; realign them so the stored tuple matches the store the
-- key writes to.
--
-- A key is never moved into another organisation: if its config now belongs
-- to a project outside the key's organisation, the key is revoked instead and
-- must be re-issued by an admin of the owning organisation.
UPDATE "APIKeys"
SET "isDeleted" = 1,
    "deletedAt" = CURRENT_TIMESTAMP
WHERE "isDeleted" = 0
  AND "organisation_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "databaseconfig"
    JOIN "projects" ON "projects"."id" = "databaseconfig"."project_id"
    WHERE "databaseconfig"."id" = "APIKeys"."database_config_id"
      AND "projects"."organisation_id" <> "APIKeys"."organisation_id"
  );

UPDATE "APIKeys"
SET "environment" = COALESCE(
  NULLIF(lower(trim((SELECT "environment" FROM "databaseconfig" WHERE "databaseconfig"."id" = "APIKeys"."database_config_id"))), ''),
  'production'
)
WHERE "isDeleted" = 0
  AND EXISTS (SELECT 1 FROM "databaseconfig" WHERE "databaseconfig"."id" = "APIKeys"."database_config_id");

UPDATE "APIKeys"
SET "project_id" = (
  SELECT "project_id" FROM "databaseconfig" WHERE "databaseconfig"."id" = "APIKeys"."database_config_id"
)
WHERE "isDeleted" = 0
  AND EXISTS (
    SELECT 1 FROM "databaseconfig"
    JOIN "projects" ON "projects"."id" = "databaseconfig"."project_id"
    WHERE "databaseconfig"."id" = "APIKeys"."database_config_id"
      AND ("APIKeys"."organisation_id" IS NULL OR "projects"."organisation_id" = "APIKeys"."organisation_id")
  );

UPDATE "APIKeys"
SET "organisation_id" = (
  SELECT "organisation_id" FROM "projects" WHERE "projects"."id" = "APIKeys"."project_id"
)
WHERE "isDeleted" = 0
  AND "organisation_id" IS NULL
  AND "project_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "projects" WHERE "projects"."id" = "APIKeys"."project_id");

INSERT OR IGNORE INTO "project_environments" ("id", "project_id", "name", "createdAt", "updatedAt")
SELECT 'env_' || lower(hex(randomblob(16))), "project_id", lower(trim("environment")), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "APIKeys"
WHERE "isDeleted" = 0 AND "project_id" IS NOT NULL AND trim("environment") <> '';
