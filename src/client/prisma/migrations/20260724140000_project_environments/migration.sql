CREATE TABLE IF NOT EXISTS "project_environments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "project_environments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_environments_project_id_name_key" ON "project_environments"("project_id", "name");

INSERT OR IGNORE INTO "project_environments" ("id", "project_id", "name", "createdAt", "updatedAt")
SELECT 'env_' || lower(hex(randomblob(16))), "project_id", 'production', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "projects"
WHERE "id" IS NOT NULL;

INSERT OR IGNORE INTO "project_environments" ("id", "project_id", "name", "createdAt", "updatedAt")
SELECT 'env_' || lower(hex(randomblob(16))), "project_id", "environment", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "databaseconfig"
WHERE "project_id" IS NOT NULL AND "environment" IS NOT NULL AND trim("environment") <> ''
  AND EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "databaseconfig"."project_id");

INSERT OR IGNORE INTO "project_environments" ("id", "project_id", "name", "createdAt", "updatedAt")
SELECT 'env_' || lower(hex(randomblob(16))), "project_id", "environment", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "telemetry_source"
WHERE "project_id" IS NOT NULL AND "environment" IS NOT NULL AND trim("environment") <> ''
  AND EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "telemetry_source"."project_id");

INSERT OR IGNORE INTO "project_environments" ("id", "project_id", "name", "createdAt", "updatedAt")
SELECT 'env_' || lower(hex(randomblob(16))), "project_id", "environment", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "telemetry_source_binding"
WHERE "project_id" IS NOT NULL AND "environment" IS NOT NULL AND trim("environment") <> ''
  AND EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = "telemetry_source_binding"."project_id");
