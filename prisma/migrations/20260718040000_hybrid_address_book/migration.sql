-- CreateEnum
CREATE TYPE "AddressBookContactOrigin" AS ENUM ('IMPORTED', 'WHATSAPP_SYNC', 'EXTERNAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "AddressBookContactStatus" AS ENUM ('VERIFIED', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ContactImportStatus" AS ENUM ('DRAFT', 'PREVIEWED', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ContactImportItemAction" AS ENUM ('CREATE', 'UPDATE', 'SKIP', 'ERROR');

-- AlterTable
ALTER TABLE "WhatsAppAccount" ADD COLUMN     "defaultPhoneCountry" TEXT NOT NULL DEFAULT 'ES';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "addressBookContactId" TEXT;

-- CreateTable
CREATE TABLE "AddressBookContact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "company" TEXT,
    "tags" TEXT,
    "origin" "AddressBookContactOrigin" NOT NULL,
    "status" "AddressBookContactStatus" NOT NULL DEFAULT 'VERIFIED',
    "createdById" TEXT,
    "importId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressBookContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressBookPhone" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "addressBookContactId" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressBookPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactImport" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "ContactImportStatus" NOT NULL DEFAULT 'DRAFT',
    "safeFileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "previewedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "safeError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactImportItem" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "proposedName" TEXT,
    "proposedLastName" TEXT,
    "proposedEmail" TEXT,
    "proposedCompany" TEXT,
    "proposedTags" TEXT,
    "normalizedPhone" TEXT,
    "action" "ContactImportItemAction" NOT NULL,
    "safeError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AddressBookContact_accountId_displayName_idx" ON "AddressBookContact"("accountId", "displayName");

-- CreateIndex
CREATE INDEX "AddressBookContact_accountId_origin_idx" ON "AddressBookContact"("accountId", "origin");

-- CreateIndex
CREATE INDEX "AddressBookContact_accountId_status_idx" ON "AddressBookContact"("accountId", "status");

-- CreateIndex
CREATE INDEX "AddressBookPhone_accountId_normalizedPhone_idx" ON "AddressBookPhone"("accountId", "normalizedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "AddressBookPhone_accountId_normalizedPhone_key" ON "AddressBookPhone"("accountId", "normalizedPhone");

-- CreateIndex
CREATE INDEX "ContactImport_accountId_createdAt_idx" ON "ContactImport"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactImport_createdById_idx" ON "ContactImport"("createdById");

-- CreateIndex
CREATE INDEX "ContactImportItem_importId_action_idx" ON "ContactImportItem"("importId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "ContactImportItem_importId_rowNumber_key" ON "ContactImportItem"("importId", "rowNumber");

-- CreateIndex
CREATE INDEX "Contact_addressBookContactId_idx" ON "Contact"("addressBookContactId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_addressBookContactId_fkey" FOREIGN KEY ("addressBookContactId") REFERENCES "AddressBookContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddressBookContact" ADD CONSTRAINT "AddressBookContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddressBookContact" ADD CONSTRAINT "AddressBookContact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddressBookContact" ADD CONSTRAINT "AddressBookContact_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ContactImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddressBookPhone" ADD CONSTRAINT "AddressBookPhone_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddressBookPhone" ADD CONSTRAINT "AddressBookPhone_addressBookContactId_fkey" FOREIGN KEY ("addressBookContactId") REFERENCES "AddressBookContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactImport" ADD CONSTRAINT "ContactImport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactImport" ADD CONSTRAINT "ContactImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactImportItem" ADD CONSTRAINT "ContactImportItem_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ContactImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
