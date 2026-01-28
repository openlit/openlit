-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_organisation_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "organisation_users_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "organisation_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_organisation_users" ("createdAt", "id", "isCurrent", "organisation_id", "updatedAt", "user_id") SELECT "createdAt", "id", "isCurrent", "organisation_id", "updatedAt", "user_id" FROM "organisation_users";
DROP TABLE "organisation_users";
ALTER TABLE "new_organisation_users" RENAME TO "organisation_users";
CREATE UNIQUE INDEX "organisation_users_organisation_id_user_id_key" ON "organisation_users"("organisation_id", "user_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Update existing organisation creators to have 'owner' role
UPDATE organisation_users
SET role = 'owner'
WHERE user_id IN (
    SELECT created_by_user_id FROM organisations WHERE id = organisation_users.organisation_id
);
