/*
  Warnings:

  - You are about to drop the `VerificationRequest` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "VerificationRequest";

-- CreateTable
CREATE TABLE "verificationrequest" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verificationrequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "databaseconfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "meta" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "databaseconfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "databaseconfiguser" (
    "databaseConfigId" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "verificationrequest_token_key" ON "verificationrequest"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verificationrequest_identifier_token_key" ON "verificationrequest"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "databaseconfig_name_key" ON "databaseconfig"("name");

-- CreateIndex
CREATE UNIQUE INDEX "databaseconfiguser_databaseConfigId_user_id_key" ON "databaseconfiguser"("databaseConfigId", "user_id");

-- AddForeignKey
ALTER TABLE "databaseconfig" ADD CONSTRAINT "databaseconfig_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "databaseconfiguser" ADD CONSTRAINT "databaseconfiguser_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "databaseconfiguser" ADD CONSTRAINT "databaseconfiguser_databaseConfigId_fkey" FOREIGN KEY ("databaseConfigId") REFERENCES "databaseconfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
