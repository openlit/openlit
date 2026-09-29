PRAGMA foreign_keys=OFF;

CREATE TABLE "new_telemetry_source_binding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "source_id" TEXT,
    "database_config_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "telemetry_source_binding_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "telemetry_source_binding_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "telemetry_source" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "telemetry_source_binding_database_config_id_fkey" FOREIGN KEY ("database_config_id") REFERENCES "databaseconfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_telemetry_source_binding" ("id", "project_id", "signal", "environment", "source_id", "createdAt", "updatedAt")
SELECT "id", "project_id", "signal", "environment", "source_id", "createdAt", "updatedAt"
FROM "telemetry_source_binding";

DROP TABLE "telemetry_source_binding";
ALTER TABLE "new_telemetry_source_binding" RENAME TO "telemetry_source_binding";

CREATE UNIQUE INDEX "telemetry_source_binding_project_id_signal_environment_key" ON "telemetry_source_binding"("project_id", "signal", "environment");
PRAGMA foreign_keys=ON;
