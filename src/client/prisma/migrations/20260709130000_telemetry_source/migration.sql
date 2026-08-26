-- CreateTable
CREATE TABLE "telemetry_source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'clickhouse',
    "signals" TEXT NOT NULL DEFAULT 'traces,logs,metrics',
    "settings" TEXT,
    "secret_ref" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "user_id" TEXT,
    CONSTRAINT "telemetry_source_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "telemetry_source_name_project_id_key" ON "telemetry_source"("name", "project_id");
