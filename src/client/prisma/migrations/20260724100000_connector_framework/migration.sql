CREATE TABLE "connector_instances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organisation_id" TEXT,
    "project_id" TEXT,
    "settings" TEXT NOT NULL DEFAULT '{}',
    "secret_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "connector_instances_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "connector_instances_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "connector_bindings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connector_id" TEXT NOT NULL,
    "consumer_type" TEXT NOT NULL,
    "consumer_key" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "connector_bindings_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connector_instances" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "connector_instances_name_organisation_id_project_id_key" ON "connector_instances"("name", "organisation_id", "project_id");
CREATE INDEX "connector_instances_category_type_idx" ON "connector_instances"("category", "type");
CREATE UNIQUE INDEX "connector_bindings_connector_id_consumer_type_consumer_key_key" ON "connector_bindings"("connector_id", "consumer_type", "consumer_key");
CREATE INDEX "connector_bindings_consumer_type_consumer_key_idx" ON "connector_bindings"("consumer_type", "consumer_key");
