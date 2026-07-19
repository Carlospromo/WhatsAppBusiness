-- AlterTable
ALTER TABLE "Contact"
  ADD COLUMN "profilePictureUrl" TEXT,
  ADD COLUMN "profilePictureUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Contact_accountId_profilePictureUpdatedAt_idx" ON "Contact"("accountId", "profilePictureUpdatedAt");
