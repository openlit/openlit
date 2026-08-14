-- CreateTable
CREATE TABLE "organisations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "created_by_user_id" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "organisation_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "organisation_users_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "organisation_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "organisation_invited_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisation_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invited_by_user_id" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organisation_invited_users_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
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
    "organisation_id" TEXT,
    CONSTRAINT "databaseconfig_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "databaseconfig_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_databaseconfig" ("createdAt", "database", "environment", "host", "id", "name", "password", "port", "query", "updatedAt", "user_id", "username") SELECT "createdAt", "database", "environment", "host", "id", "name", "password", "port", "query", "updatedAt", "user_id", "username" FROM "databaseconfig";
DROP TABLE "databaseconfig";
ALTER TABLE "new_databaseconfig" RENAME TO "databaseconfig";
CREATE UNIQUE INDEX "databaseconfig_name_organisation_id_key" ON "databaseconfig"("name", "organisation_id");
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "email_verified" DATETIME,
    "password" TEXT,
    "image" TEXT,
    "has_completed_onboarding" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_users" ("createdAt", "email", "email_verified", "id", "image", "name", "password", "updatedAt") SELECT "createdAt", "email", "email_verified", "id", "image", "name", "password", "updatedAt" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "organisations_slug_key" ON "organisations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organisation_users_organisation_id_user_id_key" ON "organisation_users"("organisation_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organisation_invited_users_organisation_id_email_key" ON "organisation_invited_users"("organisation_id", "email");
