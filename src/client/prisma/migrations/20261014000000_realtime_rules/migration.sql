-- CreateTable
CREATE TABLE "realtime_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisation_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "owner" TEXT NOT NULL DEFAULT 'alert',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "definition" TEXT NOT NULL DEFAULT '{}',
    "created_by_user_id" TEXT,
    "updated_by_user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "realtime_rules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "realtime_rules_project_id_environment_owner_idx" ON "realtime_rules"("project_id", "environment", "owner");
CREATE INDEX "realtime_rules_organisation_id_idx" ON "realtime_rules"("organisation_id");
CREATE INDEX "realtime_rules_enabled_idx" ON "realtime_rules"("enabled");
