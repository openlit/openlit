-- Allow multiple ClickHouse connectors in the same project environment.
-- The name/environment uniqueness constraint remains, so connector names must
-- still be unique within an environment.
DROP INDEX IF EXISTS "databaseconfig_project_id_environment_key";
