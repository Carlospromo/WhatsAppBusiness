-- CreateEnum
CREATE TYPE "MediaAttachmentKind" AS ENUM ('IMAGE', 'AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaAttachmentStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'STORED', 'RETRYING', 'FAILED', 'REJECTED_LIMIT', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "MediaAttachment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "kind" "MediaAttachmentKind" NOT NULL,
    "status" "MediaAttachmentStatus" NOT NULL DEFAULT 'PENDING',
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" INTEGER,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT,
    "storedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "safeError" TEXT,
    "sourceEnvelopeCiphertext" TEXT,
    "sourceEnvelopeIv" TEXT,
    "sourceEnvelopeVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAttachment_objectKey_key" ON "MediaAttachment"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAttachment_messageId_position_key" ON "MediaAttachment"("messageId", "position");

-- CreateIndex
CREATE INDEX "MediaAttachment_accountId_status_idx" ON "MediaAttachment"("accountId", "status");

-- CreateIndex
CREATE INDEX "MediaAttachment_messageId_idx" ON "MediaAttachment"("messageId");

-- AddForeignKey
ALTER TABLE "MediaAttachment" ADD CONSTRAINT "MediaAttachment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAttachment" ADD CONSTRAINT "MediaAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
