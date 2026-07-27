DROP INDEX IF EXISTS "databaseconfig_name_project_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "databaseconfig_name_project_id_environment_key"
ON "databaseconfig"("name", "project_id", "environment");
