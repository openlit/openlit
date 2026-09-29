ALTER TABLE "telemetry_source_binding" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'production';

DROP INDEX IF EXISTS "telemetry_source_name_project_id_key";
DROP INDEX IF EXISTS "telemetry_source_binding_project_id_signal_key";

CREATE UNIQUE INDEX "telemetry_source_name_project_id_environment_key" ON "telemetry_source"("name", "project_id", "environment");
CREATE UNIQUE INDEX "telemetry_source_binding_project_id_signal_environment_key" ON "telemetry_source_binding"("project_id", "signal", "environment");
