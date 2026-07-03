-- Shared project membership table for OSS project sharing.
-- CE stores the membership relation but does not enforce enterprise RBAC
-- permission checks. Existing organisation members retain access to every
-- existing project in their organisations.
CREATE TABLE "project_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "organisation_user_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_users_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_users_organisation_user_id_fkey" FOREIGN KEY ("organisation_user_id") REFERENCES "organisation_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "project_users_project_id_organisation_user_id_key" ON "project_users"("project_id", "organisation_user_id");
CREATE INDEX "project_users_user_id_idx" ON "project_users"("user_id");

INSERT OR IGNORE INTO "project_users" ("id", "project_id", "organisation_user_id", "user_id", "createdAt")
SELECT lower(hex(randomblob(12))), p."id", ou."id", ou."user_id", CURRENT_TIMESTAMP
FROM "organisation_users" ou
JOIN "projects" p ON p."organisation_id" = ou."organisation_id";
