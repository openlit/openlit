-- Normalize pre-environment rows created with an empty environment.
-- Keep an existing production binding when both rows exist.
DELETE FROM "telemetry_source_binding"
WHERE trim("environment") = ''
  AND EXISTS (
    SELECT 1 FROM "telemetry_source_binding" production
    WHERE production."project_id" = "telemetry_source_binding"."project_id"
      AND production."signal" = "telemetry_source_binding"."signal"
      AND production."environment" = 'production'
  );

UPDATE "databaseconfig"
SET "environment" = 'production'
WHERE trim("environment") = ''
  AND NOT EXISTS (
    SELECT 1 FROM "databaseconfig" production
    WHERE production."project_id" = "databaseconfig"."project_id"
      AND production."name" = "databaseconfig"."name"
      AND production."environment" = 'production'
  );

UPDATE "telemetry_source"
SET "environment" = 'production'
WHERE trim("environment") = ''
  AND NOT EXISTS (
    SELECT 1 FROM "telemetry_source" production
    WHERE production."project_id" = "telemetry_source"."project_id"
      AND production."name" = "telemetry_source"."name"
      AND production."environment" = 'production'
  );

UPDATE "telemetry_source_binding"
SET "environment" = 'production'
WHERE trim("environment") = '';
