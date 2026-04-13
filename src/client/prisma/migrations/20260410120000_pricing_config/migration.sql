-- CreateTable
CREATE TABLE "PricingConfigs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "database_config_id" TEXT NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "recurringTime" TEXT NOT NULL DEFAULT '',
    "meta" TEXT NOT NULL DEFAULT '{}'
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingConfigs_database_config_id_key" ON "PricingConfigs"("database_config_id");
