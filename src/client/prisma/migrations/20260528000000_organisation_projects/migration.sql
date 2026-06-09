-- Add projects between organisations and database configs.
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisation_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "projects_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "organisation_users" ADD COLUMN "current_project_id" TEXT;
ALTER TABLE "databaseconfig" ADD COLUMN "project_id" TEXT;

INSERT INTO "projects" ("id", "organisation_id", "name", "slug", "is_default", "createdAt", "updatedAt")
SELECT
    'prj_' || lower(hex(randomblob(16))),
    "id",
    'Default Project',
    'default',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "organisations";

UPDATE "databaseconfig"
SET "project_id" = (
    SELECT "projects"."id"
    FROM "projects"
    WHERE "projects"."organisation_id" = "databaseconfig"."organisation_id"
      AND "projects"."is_default" = true
    LIMIT 1
)
WHERE "organisation_id" IS NOT NULL;

UPDATE "organisation_users"
SET "current_project_id" = (
    SELECT "projects"."id"
    FROM "projects"
    WHERE "projects"."organisation_id" = "organisation_users"."organisation_id"
      AND "projects"."is_default" = true
    LIMIT 1
)
WHERE "current_project_id" IS NULL;

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_databaseconfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "username" TEXT NOT NULL DEFAULT 'admin',
    "password" TEXT,
    "host" TEXT NOT NULL DEFAULT '127.0.0.1',
    "port" TEXT NOT NULL DEFAULT '8123',
    "database" TEXT NOT NULL DEFAULT 'openlit',
    "query" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    CONSTRAINT "databaseconfig_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "databaseconfig_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_databaseconfig" ("createdAt", "database", "environment", "host", "id", "name", "password", "port", "project_id", "query", "updatedAt", "user_id", "username")
SELECT "createdAt", "database", "environment", "host", "id", "name", "password", "port", "project_id", "query", "updatedAt", "user_id", "username"
FROM "databaseconfig";
DROP TABLE "databaseconfig";
ALTER TABLE "new_databaseconfig" RENAME TO "databaseconfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE UNIQUE INDEX "projects_organisation_id_slug_key" ON "projects"("organisation_id", "slug");
CREATE UNIQUE INDEX "databaseconfig_name_project_id_key" ON "databaseconfig"("name", "project_id");
