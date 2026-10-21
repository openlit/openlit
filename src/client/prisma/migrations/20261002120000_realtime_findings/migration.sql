-- CreateTable
CREATE TABLE "realtime_findings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisation_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "rule_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "metric" TEXT,
    "operator" TEXT,
    "value" REAL NOT NULL,
    "threshold" REAL NOT NULL,
    "window_sec" INTEGER,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "group" TEXT NOT NULL DEFAULT '{}',
    "sample" TEXT NOT NULL DEFAULT '{}',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" DATETIME NOT NULL,
    "last_seen_at" DATETIME NOT NULL,
    "resolved_at" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "realtime_findings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "realtime_findings_dedupe_key_key" ON "realtime_findings"("dedupe_key");
CREATE INDEX "realtime_findings_project_id_environment_last_seen_at_idx" ON "realtime_findings"("project_id", "environment", "last_seen_at");
CREATE INDEX "realtime_findings_organisation_id_idx" ON "realtime_findings"("organisation_id");
