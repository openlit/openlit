ALTER TABLE "telemetry_source" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'production';
ALTER TABLE "connector_instances" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'production';
ALTER TABLE "connector_bindings" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'production';

DROP INDEX IF EXISTS "connector_instances_name_organisation_id_project_id_key";
DROP INDEX IF EXISTS "connector_bindings_connector_id_consumer_type_consumer_key_key";

CREATE UNIQUE INDEX "connector_instances_name_organisation_id_project_id_environment_key" ON "connector_instances"("name", "organisation_id", "project_id", "environment");
CREATE UNIQUE INDEX "connector_bindings_connector_id_consumer_type_consumer_key_environment_key" ON "connector_bindings"("connector_id", "consumer_type", "consumer_key", "environment");
