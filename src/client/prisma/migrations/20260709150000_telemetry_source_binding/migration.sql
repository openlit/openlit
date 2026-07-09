-- CreateTable
CREATE TABLE "telemetry_source_binding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "telemetry_source_binding_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "telemetry_source_binding_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "telemetry_source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "telemetry_source_binding_project_id_signal_key" ON "telemetry_source_binding"("project_id", "signal");
