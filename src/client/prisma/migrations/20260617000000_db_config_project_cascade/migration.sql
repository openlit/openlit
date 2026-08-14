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
    CONSTRAINT "databaseconfig_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_databaseconfig" ("createdAt", "database", "environment", "host", "id", "name", "password", "port", "project_id", "query", "updatedAt", "user_id", "username")
SELECT "createdAt", "database", "environment", "host", "id", "name", "password", "port", "project_id", "query", "updatedAt", "user_id", "username"
FROM "databaseconfig";

DROP TABLE "databaseconfig";
ALTER TABLE "new_databaseconfig" RENAME TO "databaseconfig";

CREATE UNIQUE INDEX "databaseconfig_name_project_id_key" ON "databaseconfig"("name", "project_id");

CREATE TABLE "new_databaseconfiguser" (
    "databaseConfigId" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canShare" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    CONSTRAINT "databaseconfiguser_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "databaseconfiguser_databaseConfigId_fkey" FOREIGN KEY ("databaseConfigId") REFERENCES "databaseconfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_databaseconfiguser" ("canDelete", "canEdit", "canShare", "createdAt", "databaseConfigId", "isCurrent", "updatedAt", "user_id")
SELECT "canDelete", "canEdit", "canShare", "createdAt", "databaseConfigId", "isCurrent", "updatedAt", "user_id"
FROM "databaseconfiguser"
WHERE "databaseConfigId" IN (SELECT "id" FROM "databaseconfig");

DROP TABLE "databaseconfiguser";
ALTER TABLE "new_databaseconfiguser" RENAME TO "databaseconfiguser";

CREATE UNIQUE INDEX "databaseconfiguser_databaseConfigId_user_id_key" ON "databaseconfiguser"("databaseConfigId", "user_id");

-- Preserve existing organisation-level access after introducing the project
-- layer. Any user who was already a member of an organisation gets access to
-- all DB configs attached to projects in that organisation. Config creators
-- retain owner-level DB-config actions; other members get read/select access.
INSERT OR IGNORE INTO "databaseconfiguser" (
    "databaseConfigId",
    "user_id",
    "isCurrent",
    "canEdit",
    "canShare",
    "canDelete",
    "createdAt",
    "updatedAt"
)
SELECT
    dc."id",
    ou."user_id",
    CASE
        WHEN ou."current_project_id" = dc."project_id"
         AND dc."id" = (
            SELECT first_dc."id"
            FROM "databaseconfig" first_dc
            WHERE first_dc."project_id" = dc."project_id"
            ORDER BY first_dc."createdAt" ASC, first_dc."id" ASC
            LIMIT 1
         )
         AND NOT EXISTS (
            SELECT 1
            FROM "databaseconfiguser" existing_current
            JOIN "databaseconfig" existing_dc ON existing_dc."id" = existing_current."databaseConfigId"
            JOIN "projects" existing_project ON existing_project."id" = existing_dc."project_id"
            WHERE existing_current."user_id" = ou."user_id"
              AND existing_current."isCurrent" = true
              AND existing_project."organisation_id" = p."organisation_id"
         )
        THEN true
        ELSE false
    END,
    CASE WHEN dc."user_id" = ou."user_id" THEN true ELSE false END,
    CASE WHEN dc."user_id" = ou."user_id" THEN true ELSE false END,
    CASE WHEN dc."user_id" = ou."user_id" THEN true ELSE false END,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "organisation_users" ou
JOIN "projects" p ON p."organisation_id" = ou."organisation_id"
JOIN "databaseconfig" dc ON dc."project_id" = p."id";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
